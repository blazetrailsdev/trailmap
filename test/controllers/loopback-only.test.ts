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

function fakeRequest(env: Record<string, string>): {
  getHeader(key: string): unknown;
} {
  return { getHeader: (key: string) => env[key] };
}

describe("isLoopbackRequest", () => {
  it("accepts a request to loopback with no proxy headers", () => {
    expect(isLoopbackRequest(fakeRequest({ HTTP_HOST: "127.0.0.1" }))).toBe(true);
    expect(isLoopbackRequest(fakeRequest({ HTTP_HOST: "localhost:8080" }))).toBe(
      true,
    );
    expect(isLoopbackRequest(fakeRequest({ HTTP_HOST: "[::1]:8080" }))).toBe(true);
  });

  it("refuses a request to the public hostname", () => {
    expect(
      isLoopbackRequest(fakeRequest({ HTTP_HOST: "trailmap.deanoftech.com" })),
    ).toBe(false);
  });

  it("refuses a request with no Host header at all", () => {
    expect(isLoopbackRequest(fakeRequest({}))).toBe(false);
  });

  it("refuses a proxied request even when it claims a loopback host", () => {
    expect(
      isLoopbackRequest(
        fakeRequest({ HTTP_HOST: "127.0.0.1", HTTP_X_FORWARDED_FOR: "203.0.113.7" }),
      ),
    ).toBe(false);
  });

  // `Request#host` resolves through X-Forwarded-Host, so a client that sets it
  // could otherwise spell "127.0.0.1" for itself without ever being on the box.
  it("refuses a request carrying a forwarded host, whatever it claims", () => {
    expect(
      isLoopbackRequest(
        fakeRequest({
          HTTP_HOST: "trailmap.deanoftech.com",
          HTTP_X_FORWARDED_HOST: "127.0.0.1",
        }),
      ),
    ).toBe(false);
    expect(
      isLoopbackRequest(
        fakeRequest({ HTTP_HOST: "127.0.0.1", HTTP_X_FORWARDED_PROTO: "https" }),
      ),
    ).toBe(false);
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
      headers: {
        Host: "trailmap.deanoftech.com",
        "X-Forwarded-For": "203.0.113.7",
      },
    });

    expect(tc.response.status).toBe(404);
    expect(JSON.parse(tc.responseBody)).toEqual({ error: "not_found" });
  });
});
