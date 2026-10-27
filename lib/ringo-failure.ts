/** 504 for a ringo that did not answer in time, 502 for one that could not be reached. */
export function ringoFailure(error: unknown, timeoutMs: number): { plain: string; status: number } {
  if (error instanceof Error && error.name === "TimeoutError") {
    return { plain: `ringo did not answer in ${timeoutMs / 1000}s`, status: 504 };
  }
  const reason = error instanceof Error ? error.message : String(error);
  return { plain: `ringo is unreachable: ${reason}`, status: 502 };
}
