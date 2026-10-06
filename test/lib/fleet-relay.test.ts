/**
 * The relay, over a real listening server and a real WebSocket client: the
 * handshake, the frames, and above all that the upstream read ends when the
 * browser's socket does.
 */
import { afterEach, describe, expect, it } from "vitest";
import { getHttpAsync, type HttpServer } from "@blazetrails/ruby-compat";
import { relayEvents } from "../../lib/fleet-relay.js";

let server: HttpServer | null = null;

afterEach(async () => {
  const closing = server;
  server = null;
  if (closing) await new Promise<void>((resolve) => closing.close(() => resolve()));
});

/** A stand-in for ringo's stream: what to send, and whether the reader has gone. */
function upstream(frames: string[], { end }: { end: boolean }) {
  const state = { aborted: false, opened: 0 };
  const fetchEvents = (async (_url: unknown, init?: RequestInit) => {
    state.opened++;
    init?.signal?.addEventListener("abort", () => {
      state.aborted = true;
    });
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const frame of frames) controller.enqueue(new TextEncoder().encode(frame));
        if (end) controller.close();
        init?.signal?.addEventListener("abort", () => controller.error(new Error("aborted")));
      },
    });
    return new Response(body, { status: 200 });
  }) as typeof fetch;
  return { state, fetchEvents };
}

async function relayOn(fetchEvents: typeof fetch): Promise<string> {
  const http = await getHttpAsync();
  server = http.createServer((_req, res) => {
    res.writeHead(404);
    res.end();
  });
  server.on("upgrade", (req, socket) => {
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(req.headers)) {
      if (typeof value === "string") headers[key] = value;
    }
    relayEvents(
      socket,
      { method: req.method ?? "GET", url: req.url ?? "/", headers },
      "http://ringo.test/events",
      fetchEvents,
    );
  });
  const listening = server;
  await new Promise<void>((resolve) => listening.listen(0, "127.0.0.1", () => resolve()));
  const address = listening.address();
  return `ws://127.0.0.1:${address && typeof address === "object" ? address.port : 0}/fleet/socket`;
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

describe("relayEvents", () => {
  it("forwards each upstream event as one text message, in order, unchanged", async () => {
    const { fetchEvents } = upstream(['data: {"n":1}\n\ndata: {"n"', ':2}\n\n'], { end: false });
    const socket = new WebSocket(await relayOn(fetchEvents));
    const received: string[] = [];

    await new Promise<void>((resolve) => {
      socket.onmessage = (event) => {
        received.push(String(event.data));
        if (received.length === 2) resolve();
      };
    });
    socket.close();
    await settle();

    expect(received).toEqual(['{"n":1}', '{"n":2}']);
  });

  it("stops reading upstream when the browser closes its socket", async () => {
    const { state, fetchEvents } = upstream(['data: {"n":1}\n\n'], { end: false });
    const socket = new WebSocket(await relayOn(fetchEvents));
    await new Promise<void>((resolve) => {
      socket.onmessage = () => resolve();
    });
    expect(state.aborted).toBe(false);

    socket.close();
    await settle();

    expect(state.opened).toBe(1);
    expect(state.aborted).toBe(true);
  });

  it("closes the socket when upstream ends, so the page reconnects", async () => {
    const { fetchEvents } = upstream(['data: {"n":1}\n\n'], { end: true });
    const socket = new WebSocket(await relayOn(fetchEvents));

    const code = await new Promise<number>((resolve) => {
      socket.onclose = (event) => resolve(event.code);
    });

    expect(code).toBe(1012);
  });

  it("closes the socket when upstream cannot be reached", async () => {
    const unreachable = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    const socket = new WebSocket(await relayOn(unreachable));

    const code = await new Promise<number>((resolve) => {
      socket.onclose = (event) => resolve(event.code);
    });

    expect(code).toBe(1012);
  });
});
