/**
 * `FleetController`: the control proxy against a stand-in ringo, and the socket
 * endpoint's refusals. The relay behind a successful handshake is tested over a
 * real socket in `test/lib/fleet-relay.test.ts`; a controller test case has no
 * connection to hijack.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { getHttpAsync, setEnv, type HttpServer } from "@blazetrails/ruby-compat";
import { FleetController } from "../../app/controllers/fleet-controller.js";
import { controllerTestCase } from "../support/controller-test-case.js";

interface Received {
  url: string | undefined;
  contentType: string | undefined;
  body: string;
}

let ringo: HttpServer;
let ringoBaseUrl = "";
let received: Received[] = [];

beforeAll(async () => {
  const http = await getHttpAsync();
  ringo = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => {
      body += new TextDecoder().decode(chunk);
    });
    req.on("end", () => {
      const contentType = req.headers["content-type"];
      received.push({
        url: req.url,
        contentType: typeof contentType === "string" ? contentType : undefined,
        body,
      });
      if (body.includes("blocked")) {
        res.writeHead(409);
        res.end("blocked: CI is red");
      } else {
        res.writeHead(200);
        res.end("merged");
      }
    });
  });
  await new Promise<void>((resolve) => ringo.listen(0, "127.0.0.1", () => resolve()));
  const address = ringo.address();
  ringoBaseUrl = `http://127.0.0.1:${address && typeof address === "object" ? address.port : 0}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => ringo.close(() => resolve()));
});

afterEach(() => {
  received = [];
  setEnv("RINGO_BASE", undefined);
});

async function control(path: string, body?: unknown) {
  const tc = await controllerTestCase(FleetController);
  await tc.post("control", {
    params: { path },
    ...(body === undefined ? {} : { body: JSON.stringify(body), as: "json" }),
  });
  return { status: tc.response.status, body: tc.response.body };
}

describe("FleetController#control", () => {
  it("forwards a listed control to ringo and answers with ringo's own status and text", async () => {
    setEnv("RINGO_BASE", ringoBaseUrl);

    const response = await control("merge-pr", { owner: "o", repo: "r", pr: 7 });

    expect(response).toEqual({ status: 200, body: "merged" });
    expect(received).toHaveLength(1);
    expect(received[0]!.url).toBe("/merge-pr");
    expect(received[0]!.contentType).toContain("application/json");
    expect(JSON.parse(received[0]!.body)).toEqual({ owner: "o", repo: "r", pr: 7 });
  });

  it("passes a refusal through, so the button can say why", async () => {
    setEnv("RINGO_BASE", ringoBaseUrl);

    const response = await control("merge-pr", { note: "blocked" });

    expect(response).toEqual({ status: 409, body: "blocked: CI is red" });
  });

  it("forwards a nested ringo path and a bodiless post", async () => {
    setEnv("RINGO_BASE", ringoBaseUrl);

    await control("spawnloop/dismiss-failed");

    expect(received.map((r) => [r.url, r.body])).toEqual([["/spawnloop/dismiss-failed", ""]]);
  });

  it("refuses a ringo endpoint the page has no button for, without calling ringo", async () => {
    setEnv("RINGO_BASE", ringoBaseUrl);

    const response = await control("spawnloop/config", { enabled: true });

    expect(response.status).toBe(404);
    expect(received).toEqual([]);
  });

  it("says ringo is not configured rather than guessing where it is", async () => {
    expect((await control("merge-pr", {})).status).toBe(503);
  });

  it("answers 502 when ringo cannot be reached", async () => {
    setEnv("RINGO_BASE", "http://127.0.0.1:1");

    const response = await control("merge-pr", {});

    expect(response.status).toBe(502);
    expect(response.body).toContain("ringo is unreachable");
  });
});

describe("FleetController#socket", () => {
  it("refuses a request that is not a WebSocket handshake", async () => {
    setEnv("RINGO_BASE", ringoBaseUrl);
    const tc = await controllerTestCase(FleetController);

    await tc.get("socket");

    expect(tc.response.status).toBe(426);
  });

  it("says ringo is not configured before it takes a connection", async () => {
    const tc = await controllerTestCase(FleetController);

    await tc.get("socket");

    expect(tc.response.status).toBe(503);
  });
});
