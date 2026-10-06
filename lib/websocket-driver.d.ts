/**
 * The part of `websocket-driver` (faye, Apache-2.0) this application calls.
 * The package ships no types and there is no `@types` package for it.
 */
declare module "websocket-driver" {
  export interface DriverRequest {
    method: string;
    url: string;
    headers: Record<string, string>;
  }

  export interface Driver {
    io: {
      on(event: "data", listener: (chunk: Uint8Array) => void): unknown;
    };
    on(event: "open", listener: () => void): unknown;
    on(event: "close", listener: (event: { code: number; reason: string }) => void): unknown;
    on(event: "error", listener: (event: { message: string }) => void): unknown;
    start(): boolean;
    parse(chunk: Uint8Array): void;
    text(message: string): boolean;
    close(reason?: string, code?: number): boolean;
  }

  const websocket: {
    http(request: DriverRequest, options?: { requireMasking?: boolean }): Driver;
    isWebSocket(request: DriverRequest): boolean;
  };
  export default websocket;
}
