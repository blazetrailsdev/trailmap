import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { env } from "@blazetrails/ruby-compat";
import { include } from "@blazetrails/activesupport";
import { ApiController } from "../../app/controllers/api-controller.ts";
import { IngestToken, isIngestTokenValid, secureCompare } from "../../app/controllers/concerns/ingest-token.ts";
import { controllerTestCase } from "../support/controller-test-case.ts";

class IngestProbeController extends ApiController {
  static {
    include(this, IngestToken);
  }

  async create(): Promise<void> {
    await this.render({ json: { ok: true }, status: 201 });
  }
}

async function post(headers: Record<string, string>): Promise<{ status: number; body: string }> {
  const tc = await controllerTestCase(IngestProbeController, headers);
  await tc.post("create", { params: {}, as: "json" });
  return { status: tc.response.status, body: tc.response.body };
}

describe("secureCompare", () => {
  it("answers true only for identical strings", () => {
    expect(secureCompare("abc", "abc")).toBe(true);
    expect(secureCompare("abc", "abd")).toBe(false);
    expect(secureCompare("abc", "ab")).toBe(false);
    expect(secureCompare("abc", "abcd")).toBe(false);
  });
});

describe("isIngestTokenValid", () => {
  const request = (headers: Record<string, string>) => ({ getHeader: (key: string) => headers[key] });

  it("accepts only a Bearer header carrying the expected token", () => {
    expect(isIngestTokenValid(request({ HTTP_AUTHORIZATION: "Bearer t0k" }), "t0k")).toBe(true);
    expect(isIngestTokenValid(request({ HTTP_AUTHORIZATION: "Bearer nope" }), "t0k")).toBe(false);
    expect(isIngestTokenValid(request({ HTTP_AUTHORIZATION: "Basic t0k" }), "t0k")).toBe(false);
    expect(isIngestTokenValid(request({}), "t0k")).toBe(false);
  });

  it("fails closed when no token is configured", () => {
    expect(isIngestTokenValid(request({ HTTP_AUTHORIZATION: "Bearer " }), undefined)).toBe(false);
    expect(isIngestTokenValid(request({ HTTP_AUTHORIZATION: "Bearer x" }), "")).toBe(false);
  });
});

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

  it("refuses a missing token with a bare 401", async () => {
    const { status, body } = await post({ Host: "127.0.0.1" });
    expect(status).toBe(401);
    expect(body).toBe("");
  });

  it("refuses a wrong token with a bare 401", async () => {
    const { status, body } = await post({ Host: "127.0.0.1", Authorization: "Bearer nope" });
    expect(status).toBe(401);
    expect(body).toBe("");
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
