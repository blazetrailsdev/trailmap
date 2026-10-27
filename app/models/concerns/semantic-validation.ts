/**
 * The SEMANTIC half of validation, moved off `scripts/validate-lib.mjs`.
 *
 * What a single markdown file proves about ITSELF — frontmatter parses,
 * required keys, legal enum values, markdownlint — stays with the content,
 * because content CI runs on GitHub Actions with no network route to this
 * application (trailmap binds to loopback) and no database. Everything
 * RELATIONAL comes here, where the rows are: a story's fields judged against
 * each OTHER, a dep resolved against the story it names, a story judged against
 * its parent RFC's lifecycle.
 *
 * These run in the `ingest` validation context and NOT on every save. Ingest is
 * the write that publishes authored content, so it is where bad content must be
 * refused; the mutation verbs move one field at a time and would otherwise be
 * made to re-prove — and get stuck behind — a row they did not author.
 *
 * MESSAGES ARE PART OF THE CONTRACT, copied verbatim from validate-lib.mjs: a
 * content author should not be able to tell which half rejected them.
 */
import type { Rfc } from "../rfc.ts";
import type { Story } from "../story.ts";

/**
 * Upper bound on a story's `est-loc`, mirroring btwhooks' PR_MAX_LOC — the
 * per-PR ceiling stated to worker agents. It is NOT a rule this application
 * gets to set independently: when PR_MAX_LOC is retuned this follows, and the
 * two drifting apart is the bug this constant exists to make visible.
 */
export const MAX_EST_LOC = 700;

/**
 * A story counts as terminal-complete when it is `done` (shipped) or `closed`
 * (abandoned/superseded) — both the RFC-closure rule and the est-loc ceiling
 * stop caring about a story once its fate is settled.
 */
export function isTerminalStatus(status: string | null | undefined): boolean {
  return status === "done" || status === "closed";
}

/**
 * Cross-field lifecycle invariants: each field is legal in isolation, but only
 * some COMBINATIONS describe a story that could exist. A hand-edit, a crashed
 * agent, or a forced status flip is what leaves a row that contradicts itself.
 *
 * `ready` with un-`done` deps is deliberately NOT an error — `ready` means
 * "specified and open for pickup" and claimability is filtered by dep status in
 * the ready queue. `done` with a null `pr` is likewise legal: a story can be
 * completed before anyone reaches it.
 */
export function lifecycleErrors(story: Story): string[] {
  const errors: string[] = [];
  const status = story.status as string;
  switch (status) {
    case "draft":
    case "ready":
      for (const [key, value] of [
        ["claim", story.claim_at],
        ["assignee", story.assignee],
        ["pr", story.pr],
      ] as const) {
        if (value != null) {
          errors.push(`status: ${status} must have null ${key} (got ${JSON.stringify(value)})`);
        }
      }
      break;
    case "claimed":
      if (!story.claim_at) errors.push(`status: claimed requires a claim timestamp`);
      if (!story.assignee) errors.push(`status: claimed requires an assignee`);
      break;
    case "in-progress":
      if (!story.claim_at) errors.push(`status: in-progress requires a claim timestamp`);
      if (!story.assignee) errors.push(`status: in-progress requires an assignee`);
      if (story.pr == null) errors.push(`status: in-progress requires a pr`);
      break;
    case "blocked":
      if (!story.blocked_by) errors.push(`status: blocked requires blocked-by`);
      break;
    case "closed":
      if (!story.closed_reason) errors.push(`status: closed requires closed-reason`);
      break;
    // `done` is intentionally not shape-constrained: it may carry a full
    // claim/assignee/pr (normally worked) or have them all null (the
    // done-without-PR path), so requiring either would reject a real state.
    default:
      break;
  }
  if (status !== "blocked" && story.blocked_by != null) {
    errors.push(
      `blocked-by is set but status is "${status}" — only blocked stories carry blocked-by`,
    );
  }
  if (status !== "closed" && story.closed_reason != null) {
    errors.push(
      `closed-reason is set but status is "${status}" — only closed stories carry closed-reason`,
    );
  }
  return errors;
}

/**
 * The per-PR ceiling, checked only while the story still has to SHIP as that
 * single PR. A terminal story's `est-loc` is a historical estimate, not a claim
 * about tomorrow's PR — one story shipped as a deliberate 9000 LOC sweep, and
 * the ceiling has nothing left to say about it.
 */
export function estLocErrors(story: Story): string[] {
  if (story.est_loc == null || isTerminalStatus(story.status)) return [];
  if (story.est_loc <= MAX_EST_LOC) return [];
  return [`est-loc ${story.est_loc} exceeds the ${MAX_EST_LOC} LOC per-PR ceiling`];
}

/**
 * A `closed` RFC asserts its work is complete, so an OPEN story under it is
 * drift — either the RFC closed prematurely or the story outlived it. This has
 * reddened main more than once, which is why it stays visible through the move.
 */
export function closedRfcErrors(rfc: Rfc, stories: Story[]): string[] {
  if (rfc.status !== "closed") return [];
  return stories
    .filter((s) => !isTerminalStatus(s.status))
    .map((s) => `status: closed but story "${s.id}" is "${s.status}", not done or closed`);
}

export interface DepGraph {
  storyIds: ReadonlySet<string>;
  rfcIds: ReadonlySet<string>;
  depsOf: (id: string) => string[];
  depsRfcOf: (id: string) => string[];
  seeds: Iterable<string>;
}

export interface DepViolations {
  refViolations: { from: string; dep: string; kind: "dep" | "deps-rfc" }[];
  cycles: string[][];
}

/**
 * Reference + cycle checks over the story dep graph. Inputs are graph accessors
 * so the same traversal serves the whole index and a single post-edit node.
 * Returns structured violations with no message formatting, so each caller
 * renders them in its own voice.
 */
export function checkDepGraph(graph: DepGraph): DepViolations {
  const seedList = [...graph.seeds];
  const refViolations: DepViolations["refViolations"] = [];
  for (const from of seedList) {
    for (const dep of graph.depsOf(from)) {
      if (!graph.storyIds.has(dep)) refViolations.push({ from, dep, kind: "dep" });
    }
    for (const dep of graph.depsRfcOf(from)) {
      if (!graph.rfcIds.has(dep)) refViolations.push({ from, dep, kind: "deps-rfc" });
    }
  }

  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<string, number>();
  const cycles: string[][] = [];
  const visit = (id: string, stack: string[]): void => {
    if (color.get(id) === GRAY) {
      cycles.push([...stack, id]);
      return;
    }
    if (color.get(id) === BLACK) return;
    color.set(id, GRAY);
    for (const dep of graph.depsOf(id)) if (graph.storyIds.has(dep)) visit(dep, [...stack, id]);
    color.set(id, BLACK);
  };
  for (const id of seedList) visit(id, []);

  return { refViolations, cycles };
}

/** `checkDepGraph`'s violations, rendered in validate-lib.mjs's exact voice. */
export function depGraphMessages(violations: DepViolations): string[] {
  const messages = violations.refViolations.map(
    ({ dep, kind }) => `${kind} "${dep}" does not exist`,
  );
  for (const cycle of violations.cycles) {
    messages.push(`dep cycle detected: ${cycle.join(" → ")}`);
  }
  return messages;
}
