import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrateScratchDatabase } from "../models/schema.ts";
import { Event } from "../../app/models/event.ts";
import { Rfc } from "../../app/models/rfc.ts";
import { loadModelSchemas } from "../../lib/model-schemas.ts";
import { ApplicationController } from "../../app/controllers/application-controller.ts";
import { RfcPagesController } from "../../app/controllers/rfc-pages-controller.ts";
import { controllerTestCase } from "../support/controller-test-case.ts";
import {
  connectHubTestDatabase,
  HUB_SETUP_TIMEOUT,
  hasHubTestDatabase,
  releaseHubTestDatabase,
} from "../support/hub-schema.ts";

async function post(params: Record<string, string>): Promise<{ status: number; body: string; location: string | null }> {
  const tc = await controllerTestCase(RfcPagesController);
  await tc.post("priority", { params });
  return { status: tc.response.status, body: tc.response.body, location: tc.response.headers.get("location") ?? null };
}

async function show(id: string): Promise<string> {
  const tc = await controllerTestCase(RfcPagesController);
  await tc.get("show", { params: { id } });
  return tc.response.body;
}

beforeAll(async () => {
  ApplicationController.prependViewPath("app/views");
  await migrateScratchDatabase();
  await loadModelSchemas();
  await Rfc.create({ id: "0001-p", status: "active", title: "p", file_path: "rfcs/0001-p/README.md" });
  if (hasHubTestDatabase()) await connectHubTestDatabase();
}, HUB_SETUP_TIMEOUT);
afterAll(releaseHubTestDatabase);

describe("Rfc#prioritySet", () => {
  it("writes the row and an rfc-priority event, as the CLI's rfc-priority does", async () => {
    const rfc = await Rfc.find("0001-p");
    expect(await rfc.prioritySet(3)).toBe("rfc-priority 3: 0001-p");
    expect((await Rfc.find("0001-p")).priority).toBe(3);
    const event = await Event.where({ verb: "rfc-priority", rfc_id: "0001-p" }).last();
    expect(JSON.parse(event!.detail!)).toEqual({ arg: "3" });
    expect(event!.story_id).toBeNull();
  });

  it("refuses a negative or fractional priority", async () => {
    const rfc = await Rfc.find("0001-p");
    await expect(rfc.prioritySet(-1)).rejects.toThrow(/non-negative integer/);
    await expect(rfc.prioritySet(1.5)).rejects.toThrow(/non-negative integer/);
  });
});

describe.skipIf(!hasHubTestDatabase())("POST /rfc/<id>/priority", () => {
  it("sets the priority and redirects back to the page", async () => {
    const { status, location } = await post({ id: "0001-p", priority: "2" });
    expect(status).toBe(303);
    expect(location).toContain("/rfc/0001-p");
    expect((await Rfc.find("0001-p")).priority).toBe(2);
    const body = await show("0001-p");
    expect(body).toMatch(/name="priority"[^>]*value="2"|value="2"[^>]*name="priority"/);
    expect(body).toContain(">Clear<");
  });

  it("clears it with clear or a blank field", async () => {
    await post({ id: "0001-p", priority: "clear" });
    expect((await Rfc.find("0001-p")).priority).toBeNull();
    await post({ id: "0001-p", priority: "4" });
    await post({ id: "0001-p", priority: "" });
    expect((await Rfc.find("0001-p")).priority).toBeNull();
    expect(await show("0001-p")).not.toContain(">Clear<");
  });

  it("refuses a value that is not a non-negative integer", async () => {
    await post({ id: "0001-p", priority: "5" });
    const { status, body } = await post({ id: "0001-p", priority: "high" });
    expect(status).toBe(422);
    expect(body).toContain("priority must be a non-negative integer");
    expect((await Rfc.find("0001-p")).priority).toBe(5);
  });

  it("404s an unknown RFC", async () => {
    expect((await post({ id: "9999-nope", priority: "1" })).status).toBe(404);
  });
});
