import websocket, { type DriverRequest } from "websocket-driver";
import { sseData } from "./sse.js";

/** The hijacked connection, as the framework's handler hands it over. */
export interface RelaySocket {
  write(chunk: string | Uint8Array): unknown;
  end(): unknown;
  destroy(): unknown;
  on(event: "data", listener: (chunk: Uint8Array) => void): unknown;
  on(event: "close" | "end", listener: () => void): unknown;
  on(event: "error", listener: (error: Error) => void): unknown;
}

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
 * One upstream connection per browser, and it ends when the browser's does:
 * the socket's `close` aborts the fetch. That is the whole reason this is a
 * hijacked socket and not a streamed response — a response body is never told
 * its reader has gone, and an unread stream per closed tab is a leak that only
 * a restart clears.
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
  const upstream = new AbortController();
  let closed = false;
  const finish = (): void => {
    if (closed) return;
    closed = true;
    upstream.abort();
    socket.end();
  };

  driver.io.on("data", (chunk) => socket.write(chunk));
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
    void pump(driver, eventsUrl, upstream.signal, fetchEvents).finally(() => {
      if (!closed) driver.close("upstream ended", 1012);
    });
  });
  // The request is already parsed, so there is no `connect` to wait for:
  // `start` writes the 101 and emits `open` before it returns.
  driver.start();
}

async function pump(
  driver: { text(message: string): boolean },
  eventsUrl: string,
  signal: AbortSignal,
  fetchEvents: typeof fetch,
): Promise<void> {
  try {
    const response = await fetchEvents(eventsUrl, {
      signal,
      headers: { accept: "text/event-stream" },
    });
    if (!response.ok || response.body === null) return;
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let pending = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      const { data, rest } = sseData(pending + decoder.decode(value, { stream: true }));
      pending = rest;
      for (const message of data) driver.text(message);
    }
  } catch {
    // Aborted because the browser left, or ringo is unreachable. Either way
    // there is nothing to forward, and the caller closes the socket.
  }
}
