/**
 * The mutation endpoints.
 *
 * The rules themselves — the all-or-nothing claim, the best-effort skip, the
 * cleared fields — are the model's, and are tested against the model in
 * test/models/mutations.test.ts. What is tested HERE is only what the
 * controller adds: the loopback guard, the params it accepts, the usage
 * refusals that never reach the database, and the mapping from the CLI's exit
 * codes onto HTTP status.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { Request, Response } from "@blazetrails/actionpack";
import { migrateScratchDatabase } from "../models/schema.js";
import { Event, Rfc, Story, loadModelSchemas } from "../../app/models/index.js";
import { MutationsController } from "../../app/controllers/mutations-controller.js";

/**
 * A real POST, dispatched straight at the controller.
 *
 * NOT `ActionController::TestCase`: it overwrites `request.parameters` with
 * its own `params` option, so the JSON body — which is how every one of these
 * endpoints is called — would never be parsed. Building the rack env here
 * exercises the same path a served request takes, body decoding included.
 */
async function post(
  action: string,
  body: Record<string, unknown> = {},
  headers: Record<string, string> = {},
): Promise<{ status: number; body: any }> {
  const request = new Request({
    REQUEST_METHOD: "POST",
    PATH_INFO: `/stories/${action}`,
    // Every request the API is meant to answer arrives on loopback.
    HTTP_HOST: "127.0.0.1",
    CONTENT_TYPE: "application/json",
    "rack.input": JSON.stringify(body),
    ...Object.fromEntries(
      Object.entries(headers).map(([k, v]) => [`HTTP_${k.toUpperCase().replace(/-/g, "_")}`, v]),
    ),
  });
  const response = new Response();
  await new MutationsController().dispatch(action, request, response);
  return { status: response.status, body: JSON.parse(String(response.body)) };
}

const find = async (id: string): Promise<Story> => (await Story.findBy({ id }))!;

beforeEach(async () => {
  await migrateScratchDatabase();
  await loadModelSchemas();
  await Rfc.create({ id: "0136-trailmap", status: "active", title: "Trailmap" });
  await Story.create({ id: "s1", rfc_id: "0136-trailmap", status: "ready", est_loc: 10 });
  await Story.create({ id: "s2", rfc_id: "0136-trailmap", status: "ready", est_loc: 20 });
});

describe("MutationsController", () => {
  it("claims a batch and reports the CLI's lines", async () => {
    const { status, body } = await post("claim", { ids: ["s1", "s2"], assignee: "agent-a" });

    expect(status).toBe(200);
    expect(body).toEqual({ ok: true, lines: ["claimed s1 as agent-a", "claimed s2 as agent-a"] });
    expect((await find("s1")).assignee).toBe("agent-a");
  });

  it("defaults the assignee to the first id, as the CLI does", async () => {
    await post("claim", { ids: ["s2", "s1"] });

    expect((await find("s2")).assignee).toBe("s2");
  });

  it("writes the events row the verb owns", async () => {
    await post("claim", { ids: ["s1"], assignee: "agent-a" });

    expect(await Event.where({ story_id: "s1", verb: "claim" }).count()).toBe(1);
  });

  // The 2/3 distinction is the contract btwhooks branches on — "pick another
  // story" versus "you lost the race" — so it travels in the body, and the
  // HTTP status is derived from it rather than replacing it.
  it("answers a benign conflict with 409 and the CLI's exit code and message", async () => {
    await post("claim", { ids: ["s1"], assignee: "agent-a" });

    const { status, body } = await post("claim", { ids: ["s1"], assignee: "agent-b" });

    expect(status).toBe(409);
    expect(body).toEqual({ ok: false, error: "s1 is already claimed", exit_code: 2 });
  });

  it("answers an unknown id with 422 and the CLI's not-found message", async () => {
    const { status, body } = await post("claim", { ids: ["nope"] });

    expect(status).toBe(422);
    expect(body).toEqual({ ok: false, error: "story not found: nope", exit_code: 1 });
  });

  // A half-applied batch is what the model's transaction exists to prevent;
  // the endpoint has to not undo that by writing outside it.
  it("leaves nothing written when a batch is refused", async () => {
    await post("claim", { ids: ["s2"], assignee: "other" });

    await post("claim", { ids: ["s1", "s2"], assignee: "agent-a" });

    expect((await find("s1")).status).toBe("ready");
    expect(await Event.where({ story_id: "s1" }).count()).toBe(0);
  });

  it("releases a claimed story", async () => {
    await post("claim", { ids: ["s1"], assignee: "agent-a" });

    const { body } = await post("release", { ids: ["s1"] });

    expect(body.lines).toEqual(["released s1"]);
    expect((await find("s1")).assignee).toBeNull();
  });

  it("refuses to release something that is not claimed, with the CLI's message", async () => {
    const { status, body } = await post("release", { ids: ["s1"] });

    expect(status).toBe(409);
    expect(body.error).toBe("s1 is ready, not claimed — nothing to release");
  });

  it("marks a bundle in-progress against its PR", async () => {
    const { body } = await post("inProgress", { ids: ["s1", "s2"], pr: 7 });

    expect(body.lines).toEqual(["in-progress s1 #7", "in-progress s2 #7"]);
    expect((await find("s1")).pr).toBe(7);
  });

  // `--pr` is required for in-progress and optional for done. That asymmetry
  // is the CLI's, and dropping it would let a linked story lose its PR.
  it("refuses in-progress without a PR and accepts done without one", async () => {
    const refused = await post("inProgress", { ids: ["s1"] });
    expect(refused.status).toBe(400);
    expect(refused.body).toEqual({
      ok: false,
      error: "in-progress requires --pr",
      exit_code: 1,
    });

    const { body } = await post("done", { ids: ["s1"] });
    expect(body.lines).toEqual(["done s1"]);
  });

  // `num()` is `Number(v)`, not `parseInt` — they disagree on exactly the
  // inputs a typo produces, and `--pr 7abc` stamping PR 7 on a whole bundle is
  // the failure that matters. cli.ts:106.
  it("refuses a PR that is not a whole number rather than truncating it", async () => {
    const typo = await post("inProgress", { ids: ["s1"], pr: "7abc" });

    expect(typo.status).toBe(400);
    expect(typo.body.error).toBe("in-progress requires --pr");
    expect((await find("s1")).pr).toBeNull();
  });

  it("takes a PR the JSON body carries as a number, not only as a string", async () => {
    await post("done", { ids: ["s1"], pr: 12 });

    expect((await find("s1")).pr).toBe(12);
  });

  it("records an RFC-scoped spawn, which names no story", async () => {
    const { body } = await post("recordSpawn", { rfc: "0136-trailmap", source: "refine" });

    expect(body.lines).toEqual(["recorded spawn (refine) for rfc 0136-trailmap"]);
    expect(await Event.where({ rfc_id: "0136-trailmap", verb: "spawn" }).count()).toBe(1);
  });

  it("refuses a spawn that names neither a story nor an RFC", async () => {
    const { status, body } = await post("recordSpawn", { source: "loop" });

    expect(status).toBe(400);
    expect(body.error).toBe("record-spawn requires --source and either story ids or --rfc");
  });

  it("blocks a story with its reason", async () => {
    const { body } = await post("block", { ids: ["s1"], reason: "waiting on the API" });

    expect(body.lines).toEqual(["blocked s1"]);
    expect((await find("s1")).blocked_by).toBe("waiting on the API");
  });

  // The empty-reason rule belongs to the model, so a whitespace-only reason
  // has to reach it rather than being caught by a truthiness check here.
  it("passes a whitespace-only close reason through to the model's refusal", async () => {
    const { status, body } = await post("close", { ids: ["s1"], reason: "   " });

    expect(status).toBe(422);
    expect(body.error).toBe("close requires a reason");
  });

  it("closes a story with its reason", async () => {
    const { body } = await post("close", { ids: ["s1"], reason: "superseded" });

    expect(body.lines).toEqual(["closed s1"]);
    expect((await find("s1")).closed_reason).toBe("superseded");
  });

  it("sets a status directly", async () => {
    const { body } = await post("statusSet", { ids: ["s1"], status: "draft" });

    expect(body.lines).toEqual(["status draft: s1"]);
    expect((await find("s1")).status).toBe("draft");
  });

  // The enum column would take an unknown value and leave a row no read verb
  // can classify. The CLI never had to guard it because a human typed it.
  it("refuses an unknown status before it reaches the column", async () => {
    const { status, body } = await post("statusSet", { ids: ["s1"], status: "shipped" });

    expect(status).toBe(400);
    expect(body.error).toBe('unknown status "shipped"');
    expect((await find("s1")).status).toBe("ready");
  });

  it("sets and clears a priority", async () => {
    await post("priority", { ids: ["s1"], priority: 3 });
    expect((await find("s1")).priority).toBe(3);

    const { body } = await post("priority", { ids: ["s1"], priority: "clear" });
    expect(body.lines).toEqual(["priority (clear): s1"]);
    expect((await find("s1")).priority).toBeNull();
  });

  // `Number("high")` is NaN, which SQLite stores as NULL — so an unparseable
  // priority would silently clear one instead of being refused.
  it("refuses a priority that is neither a number nor clear", async () => {
    await post("priority", { ids: ["s1"], priority: 3 });

    const { status } = await post("priority", { ids: ["s1"], priority: "high" });

    expect(status).toBe(400);
    expect((await find("s1")).priority).toBe(3);
  });

  it("refuses a batch with no ids before touching the database", async () => {
    const { status, body } = await post("release", {});

    expect(status).toBe(400);
    expect(body.exit_code).toBe(1);
  });

  // The write API must be unreachable from the public hostname. A proxied
  // request is a 404 — not a 403, which would confirm it exists.
  it("is a 404 for anything arriving through the proxy", async () => {
    const { status, body } = await post(
      "claim",
      { ids: ["s1"] },
      { "X-Forwarded-For": "203.0.113.9" },
    );

    expect(status).toBe(404);
    expect(body).toEqual({ error: "not_found" });
    expect((await find("s1")).status).toBe("ready");
  });
});
