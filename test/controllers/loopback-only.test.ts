import { describe, it, expect } from "vitest";
import { ActionController } from "@blazetrails/actionpack";
import { ApplicationController } from "../../app/controllers/application-controller.js";
import {
  isLoopbackRequest,
  requireLoopback,
} from "../../app/controllers/concerns/loopback-only.js";

class ProbeController extends ApplicationController {
  static {
    this.beforeAction(requireLoopback);
  }

  index(): void {
    this.render({ json: { ok: true } });
  }
}

function fakeRequest(
  host: string,
  headers: Record<string, string> = {},
): { host: string; headers: { get(key: string): unknown } } {
  return { host, headers: { get: (key: string) => headers[key] } };
}

describe("isLoopbackRequest", () => {
  it("accepts a request to loopback with no proxy headers", () => {
    expect(isLoopbackRequest(fakeRequest("127.0.0.1"))).toBe(true);
    expect(isLoopbackRequest(fakeRequest("localhost"))).toBe(true);
  });

  it("refuses a request to the public hostname", () => {
    expect(isLoopbackRequest(fakeRequest("trailmap.deanoftech.com"))).toBe(
      false,
    );
  });

  it("refuses a proxied request even when it claims a loopback host", () => {
    const proxied = fakeRequest("127.0.0.1", { "X-Forwarded-For": "203.0.113.7" });
    expect(isLoopbackRequest(proxied)).toBe(false);
  });
});

describe("requireLoopback", () => {
  it("runs the action for a loopback request", async () => {
    const tc = new ActionController.TestCase(ProbeController);
    await tc.get("index", { headers: { Host: "127.0.0.1" } });

    expect(tc.response.status).toBe(200);
    expect(JSON.parse(tc.responseBody)).toEqual({ ok: true });
  });

  it("refuses a request forwarded from the public hostname", async () => {
    const tc = new ActionController.TestCase(ProbeController);
    await tc.get("index", {
      headers: { Host: "trailmap.deanoftech.com", "X-Forwarded-For": "203.0.113.7" },
    });

    expect(tc.response.status).toBe(404);
    expect(JSON.parse(tc.responseBody)).toEqual({ error: "not_found" });
  });
});
