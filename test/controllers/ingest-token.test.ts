import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { env } from "@blazetrails/ruby-compat";
import { include } from "@blazetrails/activesupport";
import { ApiController } from "../../app/controllers/api-controller.ts";
import { IngestToken } from "../../app/controllers/concerns/ingest-token.ts";
import { controllerTestCase } from "../support/controller-test-case.ts";

class IngestProbeController extends ApiController {
  static {
    include(this, IngestToken);
  }

  async create(): Promise<void> {
    await this.render({ json: { ok: true }, status: 201 });
  }
}

async function post(
  headers: Record<string, string>,
): Promise<{ status: number; body: string; challenge: unknown }> {
  const tc = await controllerTestCase(IngestProbeController, headers);
  await tc.post("create", { params: {}, as: "json" });
  return {
    status: tc.response.status,
    body: tc.response.body,
    challenge: tc.response.getHeader("WWW-Authenticate"),
  };
}

describe("IngestToken", () => {
  beforeEach(() => {
    Object.assign(env, { TRAILMAP_INGEST_TOKEN: "s3cret" });
  });
  afterEach(() => {
    Reflect.deleteProperty(env, "TRAILMAP_INGEST_TOKEN");
  });

  it("lets a loopback request with the right token through", async () => {
    const { status } = await post({ Host: "127.0.0.1", Authorization: "Bearer s3cret" });
    expect(status).toBe(201);
  });

  it("accepts Rails' Token scheme too", async () => {
    const { status } = await post({ Host: "127.0.0.1", Authorization: "Token s3cret" });
    expect(status).toBe(201);
  });

  it("refuses a missing token with the framework's challenge", async () => {
    const { status, body, challenge } = await post({ Host: "127.0.0.1" });
    expect(status).toBe(401);
    expect(challenge).toBe('Token realm="Application"');
    expect(body).toBe("HTTP Token: Access denied.\n");
  });

  it("refuses a wrong token with the framework's challenge", async () => {
    const { status, challenge } = await post({ Host: "127.0.0.1", Authorization: "Bearer nope" });
    expect(status).toBe(401);
    expect(challenge).toBe('Token realm="Application"');
  });

  it("refuses every request when TRAILMAP_INGEST_TOKEN is unset", async () => {
    Reflect.deleteProperty(env, "TRAILMAP_INGEST_TOKEN");
    const { status } = await post({ Host: "127.0.0.1", Authorization: "Bearer " });
    expect(status).toBe(401);
    Object.assign(env, { TRAILMAP_INGEST_TOKEN: "" });
    expect((await post({ Host: "127.0.0.1", Authorization: "Bearer s3cret" })).status).toBe(401);
  });

  it("runs LoopbackOnly first, so a proxied request with a valid token is a 404", async () => {
    const { status } = await post({
      Host: "trailmap.deanoftech.com",
      "X-Forwarded-For": "1.2.3.4",
      Authorization: "Bearer s3cret",
    });
    expect(status).toBe(404);
  });
});
