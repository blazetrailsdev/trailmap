/**
 * A short-lived cache in front of the fleet pages' reads of ringo.
 *
 * Every open fleet tab polls these reads, and each poll used to be one
 * request to ringo. When ringo slowed down, the polls piled up, each holding
 * a request until its timeout, and on 2026-11-25 that left trailmap's web
 * process answering nothing at all until it was restarted.
 *
 * So, per ringo path:
 * - an answer younger than `FRESH_MS` is served without asking ringo;
 * - requests that arrive while one is already out share it rather than
 *   sending their own;
 * - when ringo errors or times out, the last good answer is served if it is
 *   younger than `STALE_MS`, so a slow ringo costs viewers freshness, not the
 *   page.
 *
 * Only successful answers are kept: a failure is never cached, so the next
 * poll after it asks again.
 */

export const FRESH_MS = 3_000;
export const STALE_MS = 60_000;

export interface RingoAnswer {
  ok: boolean;
  status: number;
  text: string;
}

interface Entry {
  at: number;
  answer: RingoAnswer;
}

const good = new Map<string, Entry>();
const inFlight = new Map<string, Promise<RingoAnswer>>();

/**
 * The answer for `key`, from the cache or from `load`. `load` rejecting
 * (unreachable, timed out) rethrows unless a stale answer can stand in.
 */
export async function cachedRingoRead(
  key: string,
  load: () => Promise<RingoAnswer>,
  now: () => number = Date.now,
): Promise<RingoAnswer> {
  const hit = good.get(key);
  if (hit && now() - hit.at < FRESH_MS) return hit.answer;

  let pending = inFlight.get(key);
  if (!pending) {
    pending = load().finally(() => inFlight.delete(key));
    inFlight.set(key, pending);
  }
  try {
    const answer = await pending;
    if (answer.ok) {
      good.set(key, { at: now(), answer });
      return answer;
    }
    return staleOr(key, now, answer);
  } catch (error) {
    const stale = good.get(key);
    if (stale && now() - stale.at < STALE_MS) return stale.answer;
    throw error;
  }
}

function staleOr(key: string, now: () => number, answer: RingoAnswer): RingoAnswer {
  // A 5xx is ringo struggling: the last good answer serves the page better.
  // A 4xx is ringo meaning it, and is passed through.
  if (answer.status < 500) return answer;
  const stale = good.get(key);
  return stale && now() - stale.at < STALE_MS ? stale.answer : answer;
}

/** Forget everything; for tests. */
export function clearRingoReadCache(): void {
  good.clear();
  inFlight.clear();
}
