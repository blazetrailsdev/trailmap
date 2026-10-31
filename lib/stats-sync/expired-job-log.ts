const EXPIRED_JOB_LOG_ERROR_RE = /HTTP (404|410)/;

/**
 * True when `gh api .../actions/jobs/<id>/logs` failed because GitHub has aged
 * the log out of its retention window — a permanent 404 or 410, not a transport
 * blip worth retrying. Both codes appear in the same backlog: the newer jobs
 * answer `HTTP 404` and the oldest answer `Server Error (HTTP 410)`. See
 * {@link isTransientGhError} for the retryable set.
 */
export function isExpiredJobLogError(message: string): boolean {
  return EXPIRED_JOB_LOG_ERROR_RE.test(message);
}
