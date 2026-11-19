/** A rejection nothing can await: rethrown on a fresh task, as `void` would have left it unhandled. */
export function rethrow(error: unknown): void {
  queueMicrotask(() => {
    throw error;
  });
}
