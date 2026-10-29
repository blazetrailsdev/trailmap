import { beforeAll, describe, expect, it } from "vitest";
import { setX } from "../support/config-x.ts";
import { Dir, Open3, getFs, setEnv } from "@blazetrails/ruby-compat";
import { migrateScratchDatabase } from "../models/schema.ts";
import { Event, Rfc, Story, loadModelSchemas } from "../../app/models/index.ts";
import { ApplicationController } from "../../app/controllers/application-controller.ts";
import { RfcPagesController } from "../../app/controllers/rfc-pages-controller.ts";
import { controllerTestCase } from "../support/controller-test-case.ts";

let checkout = "";
let origin = "";

async function sh(command: string): Promise<string> {
  const [output, status] = await Open3.capture2e({ CHECKOUT: checkout, ORIGIN: origin }, command);
  if (!status.isSuccess()) throw new Error(`${command}: ${output}`);
  return output.trim();
}

async function post(action: string, params: Record<string, string>): Promise<{ status: number; body: string; location: string | null }> {
  const tc = await controllerTestCase(RfcPagesController);
  await tc.post(action, { params });
  return { status: tc.response.status, body: tc.response.body, location: tc.response.headers.get("location") ?? null };
}

async function rfc(id: string, status: string): Promise<void> {
  const file = `rfcs/${id}/README.md`;
  await sh(`mkdir -p "$CHECKOUT/rfcs/${id}"`);
  await getFs().writeFile!(`${checkout}/${file}`, `---\ntitle: ${id}\nstatus: ${status}\nupdated: 2026-01-01\n---\n\n# ${id}\n`);
  await Rfc.create({ id, status, title: id, file_path: file });
}

beforeAll(async () => {
  ApplicationController.prependViewPath("app/views");
  const root = Dir.mktmpdir("rfc-status");
  checkout = `${root}/tasks`;
  origin = `${root}/origin.git`;
  await sh(`git init -q --bare -b main "$ORIGIN" && git init -q -b main "$CHECKOUT"`);
  setX("tasks", "dir", checkout);

  await migrateScratchDatabase();
  await loadModelSchemas();

  await rfc("0001-draft", "draft");
  await rfc("0002-active", "active");
  await rfc("0003-postponed", "postponed");
  await rfc("0004-open", "active");
  await rfc("0005-finished", "active");
  await rfc("0006-closed", "closed");
  await rfc("0007-drafts", "active");
  await Story.create({ id: "open-1", rfc_id: "0004-open", status: "ready" });
  await Story.create({ id: "open-2", rfc_id: "0004-open", status: "done" });
  // Finished without a save, or the auto-close (rfc-close.ts) gets there first.
  await Story.create({ id: "gone", rfc_id: "0005-finished", status: "ready" });
  await Story.where({ id: "gone" }).updateAll({ status: "closed" });
  await Story.create({ id: "d-1", rfc_id: "0007-drafts", status: "draft" });
  await Story.create({ id: "d-2", rfc_id: "0007-drafts", status: "draft" });
  await Story.create({ id: "d-3", rfc_id: "0007-drafts", status: "ready" });

  await sh(
    `cd "$CHECKOUT" && git -c user.name=t -c user.email=t@t add -A && git -c user.name=t -c user.email=t@t commit -qm seed && git remote add origin "$ORIGIN" && git push -q origin main`,
  );
  for (const who of ["AUTHOR", "COMMITTER"]) {
    setEnv(`GIT_${who}_NAME`, "trailmap");
    setEnv(`GIT_${who}_EMAIL`, "trailmap@localhost");
  }
});

/** Each move: the row, the event, the committed frontmatter and the push. */
async function expectMoved(id: string, from: string, to: string): Promise<void> {
  const { status, location, body } = await post("move", { id, status: to });
  expect(status, body.match(/flash-error">([^<]*)/)?.[1]).toBe(303);
  expect(location).toContain(`/rfc/${id}`);
  expect((await Rfc.find(id)).status).toBe(to);
  const event = await Event.where({ verb: "rfc-status", rfc_id: id }).last();
  expect(JSON.parse(event!.detail!)).toMatchObject({ from, to });
  expect(await sh(`git -C "$ORIGIN" show main:rfcs/${id}/README.md`)).toContain(`status: ${to}`);
  expect(await sh(`git -C "$ORIGIN" log -1 --format=%s main`)).toBe(`rfc(${id}): ${from} -> ${to}`);
}

describe("RfcPagesController lifecycle", () => {
  it("marks a draft RFC ready", async () => {
    await expectMoved("0001-draft", "draft", "active");
  });

  it("moves an active RFC back to draft", async () => {
    await expectMoved("0002-active", "active", "draft");
  });

  it("postpones an RFC and makes a postponed one ready", async () => {
    await expectMoved("0003-postponed", "postponed", "active");
    await expectMoved("0003-postponed", "active", "postponed");
  });

  it("closes an RFC whose stories are all finished", async () => {
    await expectMoved("0005-finished", "active", "closed");
  });

  it("refuses to close an RFC with open stories", async () => {
    const { status, body } = await post("move", { id: "0004-open", status: "closed" });
    expect(status).toBe(422);
    expect(body).toContain(
      "RFC 0004-open still has 1 unfinished story (open-1) — close or rehome them first, or sunset the RFC.",
    );
    expect((await Rfc.find("0004-open")).status).toBe("active");
  });

  it("refuses a move the RFC's status does not offer", async () => {
    const { status, body } = await post("move", { id: "0006-closed", status: "active" });
    expect(status).toBe(409);
    expect(body).toContain("rfc 0006-closed is &quot;closed&quot;; cannot move it to &quot;active&quot;");
  });

  it("marks every draft story ready, all or nothing", async () => {
    const { status } = await post("readyDrafts", { id: "0007-drafts" });
    expect(status).toBe(303);
    expect((await Story.where({ rfc_id: "0007-drafts" }).pluck("status")).sort()).toEqual(["ready", "ready", "ready"]);

    const again = await post("readyDrafts", { id: "0007-drafts" });
    expect(again.status).toBe(409);
    expect(again.body).toContain("rfc 0007-drafts has no draft stories");
  });

  it("offers ringo's moves for the RFC's status, and none once it is closed", async () => {
    const tc = await controllerTestCase(RfcPagesController);
    await tc.get("show", { params: { id: "0004-open" } });
    const body = tc.response.body;
    expect(body).toContain("Back to draft");
    expect(body).toContain("Postpone");
    expect(body).toContain("Close RFC");
    expect(body).not.toContain("Mark ready");
    expect(body).toContain("Close this RFC? Refused while any of its stories are unfinished — use Sunset for that.");

    const closed = await controllerTestCase(RfcPagesController);
    await closed.get("show", { params: { id: "0006-closed" } });
    expect(closed.response.body).not.toContain('class="side-section rfc-actions"');
  });
});
