/**
 * The relay, over a real listening server and a real WebSocket client: the
 * handshake, the frames, and above all that the upstream read ends when the
 * browser's socket does.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { getHttpAsync, type HttpServer } from "@blazetrails/ruby-compat";
import {
  CLOSE_GRACE_MS,
  PING_INTERVAL_MS,
  UPSTREAM_CONNECT_TIMEOUT_MS,
  relayEvents,
} from "../../lib/fleet-relay.ts";

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

/**
 * The same relay over a socket that is only a recorder, for what a real one
 * cannot be made to do on demand: fall behind, or sit idle for a minute.
 */
function recordedSocket() {
  const listeners: Record<string, (() => void)[]> = {};
  const written: Uint8Array[] = [];
  const state = { accepting: true, ended: false };
  const socket = {
    write(chunk: string | Uint8Array) {
      written.push(typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk);
      return state.accepting;
    },
    end() {
      state.ended = true;
    },
    destroy() {},
    on(event: string, listener: (arg: never) => void) {
      (listeners[event] ??= []).push(listener as () => void);
    },
  };
  const emit = (event: string) => (listeners[event] ?? []).forEach((listener) => listener());
  /** Unmasked server frames after the 101: [opcode, text payload]. */
  const frames = (): [number, string][] =>
    written.slice(1).map((frame) => {
      const length = frame[1]! & 0x7f;
      const start = length === 126 ? 4 : 2;
      return [frame[0]! & 0x0f, new TextDecoder().decode(frame.subarray(start))];
    });
  return { socket, state, emit, frames };
}

const handshake = {
  method: "GET",
  url: "/fleet/socket",
  headers: {
    host: "trailmap.test",
    upgrade: "websocket",
    connection: "Upgrade",
    "sec-websocket-version": "13",
    "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
  },
};

/** An upstream the test feeds by hand. */
function fedUpstream() {
  let feed: (frame: string) => void = () => {};
  const state = { aborted: false };
  const fetchEvents = (async (_url: unknown, init?: RequestInit) => {
    init?.signal?.addEventListener("abort", () => {
      state.aborted = true;
    });
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        feed = (frame) => controller.enqueue(new TextEncoder().encode(`data: ${frame}\n\n`));
        init?.signal?.addEventListener("abort", () => controller.error(new Error("aborted")));
      },
    });
    return new Response(body, { status: 200 });
  }) as typeof fetch;
  return { fetchEvents, state, feed: (frame: string) => feed(frame) };
}

describe("relayEvents, when the browser is slow or the fleet is quiet", () => {
  it("keeps only the newest frame while the socket is backed up, and sends it on drain", async () => {
    const { socket, state, emit, frames } = recordedSocket();
    const upstreamFeed = fedUpstream();
    relayEvents(socket, handshake, "http://ringo.test/events", upstreamFeed.fetchEvents);
    await settle();

    upstreamFeed.feed("one");
    await settle();
    state.accepting = false;
    upstreamFeed.feed("two");
    await settle();
    upstreamFeed.feed("three");
    upstreamFeed.feed("four");
    await settle();
    expect(frames().map(([, text]) => text)).toEqual(["one", "two"]);

    state.accepting = true;
    emit("drain");

    expect(frames().map(([, text]) => text)).toEqual(["one", "two", "four"]);
  });

  it("pings an idle socket inside nginx's read timeout", async () => {
    vi.useFakeTimers();
    try {
      const { socket, frames } = recordedSocket();
      relayEvents(socket, handshake, "http://ringo.test/events", fedUpstream().fetchEvents);
      expect(PING_INTERVAL_MS).toBeLessThan(60_000);

      await vi.advanceTimersByTimeAsync(PING_INTERVAL_MS + 1);

      expect(frames().filter(([opcode]) => opcode === 0x9)).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("gives up on a ringo that accepts the request and never answers", async () => {
    vi.useFakeTimers();
    try {
      const { socket, state, frames } = recordedSocket();
      let aborted = false;
      const silent = ((_url: unknown, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            aborted = true;
            reject(new Error("aborted"));
          });
        })) as typeof fetch;
      relayEvents(socket, handshake, "http://ringo.test/events", silent);

      await vi.advanceTimersByTimeAsync(UPSTREAM_CONNECT_TIMEOUT_MS + 1);

      expect(aborted).toBe(true);
      expect(frames().some(([opcode]) => opcode === 0x8)).toBe(true);
      expect(state.ended).toBe(false);

      await vi.advanceTimersByTimeAsync(CLOSE_GRACE_MS + 1);

      expect(state.ended).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

