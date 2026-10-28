import websocket, { type DriverRequest } from "websocket-driver";
import { sseData } from "./sse.ts";

/** The hijacked connection, as the framework's handler hands it over. */
export interface RelaySocket {
  /** False when the chunk was queued because the peer is not keeping up. */
  write(chunk: string | Uint8Array): unknown;
  end(): unknown;
  destroy(): unknown;
  on(event: "data", listener: (chunk: Uint8Array) => void): unknown;
  on(event: "close" | "end" | "drain", listener: () => void): unknown;
  on(event: "error", listener: (error: Error) => void): unknown;
}

/**
 * How often the relay pings the browser. Under nginx's 60 s read timeout, so
 * a fleet with nothing to report does not cost the page its connection once a
 * minute.
 */
export const PING_INTERVAL_MS = 25_000;

/** How long the browser has to answer a close frame before the socket is ended. */
export const CLOSE_GRACE_MS = 5_000;

/** How long ringo has to answer the stream request with headers. */
export const UPSTREAM_CONNECT_TIMEOUT_MS = 10_000;

/** Whether a request is a WebSocket handshake this relay can answer. */
export function isWebSocketRequest(request: DriverRequest): boolean {
  return websocket.isWebSocket(request);
}

/**
 * Relay ringo's event stream to one browser over a WebSocket.
 *
 * The browser cannot reach ringo: it is another origin behind the same SSO,
 * and its stream allows no cross-origin reader. So the page opens a socket to
 * trailmap, and trailmap reads `eventsUrl` and forwards each event's JSON as
 * one text message, unchanged.
 *
 * ONE upstream connection, however many browsers: ringo's stream is a
 * sequence of whole snapshots, so every viewer subscribes to the same read
 * (`subscribe`). A viewer that joins mid-stream is sent the latest frame at
 * once. The read starts with the first viewer and is aborted when the last
 * one's socket closes. That is the whole reason this is a hijacked socket and
 * not a streamed response — a response body is never told its reader has
 * gone, and an unread stream per closed tab is a leak that only a restart
 * clears.
 *
 * When ringo's stream ends or cannot be reached, the socket is closed (1012,
 * "service restart") and the page reconnects, as it would to ringo itself.
 */
export function relayEvents(
  socket: RelaySocket,
  request: DriverRequest,
  eventsUrl: string,
  fetchEvents: typeof fetch = fetch,
): void {
  const driver = websocket.http(request);
  let unsubscribe: (() => void) | null = null;
  let closed = false;
  let keepalive: ReturnType<typeof setInterval> | null = null;
  const finish = (): void => {
    if (closed) return;
    closed = true;
    if (keepalive !== null) clearInterval(keepalive);
    unsubscribe?.();
    socket.end();
  };

  // A viewer on a slow link must not make this process buffer for them. Every
  // frame from ringo is a whole snapshot that replaces the last, so while the
  // socket is backed up only the NEWEST frame is kept, and it goes out when
  // the socket drains.
  let congested = false;
  let latest: string | null = null;
  driver.io.on("data", (chunk) => {
    if (socket.write(chunk) === false) congested = true;
  });
  socket.on("drain", () => {
    congested = false;
    if (latest !== null && !closed) {
      const frame = latest;
      latest = null;
      driver.text(frame);
    }
  });
  const forward = (frame: string): void => {
    if (congested) latest = frame;
    else driver.text(frame);
  };

  socket.on("data", (chunk) => driver.parse(chunk));
  socket.on("close", finish);
  socket.on("end", finish);
  socket.on("error", () => {
    finish();
    socket.destroy();
  });
  driver.on("close", finish);
  driver.on("error", finish);
  driver.on("open", () => {
    keepalive = setInterval(() => driver.ping(), PING_INTERVAL_MS);
    unsubscribe = subscribe(eventsUrl, fetchEvents, {
      frame: forward,
      ended: () => {
        unsubscribe = null;
        if (closed) return;
        // A close handshake, so the page sees 1012 and reconnects. A browser
        // answers it at once; one that does not is hung up on.
        driver.close("upstream ended", 1012);
        setTimeout(finish, CLOSE_GRACE_MS);
      },
    });
  });
  // The request is already parsed, so there is no `connect` to wait for:
  // `start` writes the 101 and emits `open` before it returns.
  driver.start();
}

/** One viewer of a shared upstream read. */
interface Viewer {
  frame(frame: string): void;
  /** The upstream read ended, or never started; the viewer is dropped. */
  ended(): void;
}

/** One upstream read of ringo's stream and everyone reading it. */
interface SharedStream {
  viewers: Set<Viewer>;
  latest: string | null;
  upstream: AbortController;
}

/**
 * The reads in flight, by fetch and then URL. Keyed by the fetch too so a
 * test's stand-in ringo never shares a read with another's.
 */
const streams = new WeakMap<typeof fetch, Map<string, SharedStream>>();

/** How many upstream reads are open for `eventsUrl` right now: zero or one. */
export function upstreamReads(eventsUrl: string, fetchEvents: typeof fetch = fetch): number {
  return streams.get(fetchEvents)?.has(eventsUrl) ? 1 : 0;
}

/**
 * Join the read of `eventsUrl`, starting it if this is the first viewer.
 * Answers the function that leaves it; the last to leave aborts the read.
 */
function subscribe(eventsUrl: string, fetchEvents: typeof fetch, viewer: Viewer): () => void {
  let byUrl = streams.get(fetchEvents);
  if (byUrl === undefined) streams.set(fetchEvents, (byUrl = new Map()));
  let stream = byUrl.get(eventsUrl);
  if (stream === undefined) {
    const started: SharedStream = { viewers: new Set(), latest: null, upstream: new AbortController() };
    stream = started;
    byUrl.set(eventsUrl, started);
    const fanOut = (frame: string): void => {
      started.latest = frame;
      // One viewer's closed socket must not cost the others this frame.
      for (const v of started.viewers) {
        try {
          v.frame(frame);
        } catch {
          // That viewer's own close path removes it.
        }
      }
    };
    void pump(fanOut, eventsUrl, started.upstream, fetchEvents).finally(() => {
      // Gone before anyone else can join it: the next viewer starts afresh.
      if (byUrl.get(eventsUrl) === started) byUrl.delete(eventsUrl);
      const left = [...started.viewers];
      started.viewers.clear();
      for (const v of left) v.ended();
    });
  }
  const joined = stream;
  joined.viewers.add(viewer);
  if (joined.latest !== null) viewer.frame(joined.latest);
  return () => {
    if (!joined.viewers.delete(viewer) || joined.viewers.size > 0) return;
    if (byUrl.get(eventsUrl) === joined) byUrl.delete(eventsUrl);
    joined.upstream.abort();
  };
}

async function pump(
  forward: (frame: string) => void,
  eventsUrl: string,
  upstream: AbortController,
  fetchEvents: typeof fetch,
): Promise<void> {
  // The timeout is on ringo ANSWERING, not on the stream, which is meant to
  // stay open: it is cleared as soon as the response headers are in.
  const connecting = setTimeout(() => upstream.abort(), UPSTREAM_CONNECT_TIMEOUT_MS);
  try {
    const response = await fetchEvents(eventsUrl, {
      signal: upstream.signal,
      headers: { accept: "text/event-stream" },
    });
    clearTimeout(connecting);
    if (!response.ok || response.body === null) return;
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let pending = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      const { data, rest } = sseData(pending + decoder.decode(value, { stream: true }));
      pending = rest;
      for (const message of data) forward(message);
    }
  } catch {
    // Aborted because the last browser left or ringo never answered, or ringo is
    // unreachable. Either way there is nothing to forward, and the caller
    // closes the socket.
  } finally {
    clearTimeout(connecting);
  }
}
