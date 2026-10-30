/**
 * ringo's `core` package, run in-process.
 *
 * `vendor/ringo/core.wasm` is btwhooks' `core` Go package — the part of ringo
 * that is pure computation — compiled for WASI at the pinned commit. Loading
 * it here means a renderer ringo already has is EXECUTED rather than ported:
 * there is one implementation, so there is nothing to drift and no parity gate
 * to keep green. That is the opposite trade from `app/helpers/markdown-helper`,
 * which is a port and needs `pnpm gate:markdown` for exactly that reason.
 *
 * Use it for bytes-in, bytes-out work with no framework surface in it. A
 * terminal emulator written twice teaches trails nothing; the response that
 * streams its output does, and that part stays TypeScript.
 *
 * The module is a WASI *command*: each call instantiates it, hands it argv and
 * stdin, runs `_start` to completion and collects stdout. Nothing is shared
 * between calls, so they cannot interfere, and the compiled module is cached so
 * a call costs an instantiation, not a compile (about 6 ms).
 *
 * A CALL IS SYNCHRONOUS, and it holds the event loop for as long as it runs.
 * `_start` does not yield, so the `Promise` here only covers loading the
 * module. Measured over ringo's own archive, the pane replay costs roughly
 * 110 ms per megabyte of log: the median log is 2 MB (0.2 s), the 90th
 * percentile 10 MB (1.1 s), the largest 104 MB (10 s). The transcript parse
 * costs about the same: 60–130 ms per megabyte over the largest transcripts on
 * the box (44–400 MB), 9 s for 128 MB, and `maxSteps` does not lower it
 * because every line is still read. Fine for a script or a
 * gate; a request handler has to bound what it passes in, or every other
 * request waits behind the replay. Moving it off the main thread needs a
 * worker, and trails has no adapter for one yet — that is a framework story,
 * not something to reach around from here.
 *
 * The WASI host below is written out rather than taken from `node:wasi`
 * because the module asks for very little — sixteen imports, listed in
 * `host()` — and all of it can be answered from memory. That keeps stdin and
 * stdout off the filesystem (node:wasi wants file descriptors for both) and
 * keeps this file on the runtime-neutral surface the rest of trailmap uses.
 * It is NOT a general WASI implementation: there is no filesystem, no
 * environment and no preopened directory, because `core` may not use any.
 */
import { getFs } from "@blazetrails/ruby-compat";

const WASM = new URL("../vendor/ringo/core.wasm", import.meta.url).pathname;

/** WASI errno values the host answers with. */
const ESUCCESS = 0;
const EBADF = 8;

/** `random_get` may be asked for more than `getRandomValues` gives in one call. */
const RANDOM_CHUNK = 65536;

/** Thrown through the module's stack by `proc_exit`, which must not return. */
class Exit {
  readonly code: number;

  constructor(code: number) {
    this.code = code;
  }
}

/** `core` exited non-zero; `message` is what it wrote to stderr. */
export class RingoCoreError extends Error {
  readonly args: readonly string[];
  readonly code: number;

  constructor(args: readonly string[], code: number, stderr: string) {
    super(`ringo core ${args.join(" ")} exited ${code}: ${stderr.trim() || "(nothing on stderr)"}`);
    this.args = args;
    this.code = code;
    this.name = "RingoCoreError";
  }
}

let compiled: Promise<WebAssembly.Module> | undefined;

function module(): Promise<WebAssembly.Module> {
  compiled ??= (async () => {
    const fs = getFs();
    return WebAssembly.compile(new Uint8Array(await fs.readFile(WASM)));
  })();
  // A failed read must not be cached as the answer for the life of the process.
  compiled.catch(() => (compiled = undefined));
  return compiled;
}

/**
 * Run `core <args...>` with `input` on stdin and hand back stdout.
 *
 * Rejects with `RingoCoreError` when the command exits non-zero, carrying its
 * stderr — a usage error or a malformed corpus is ringo's message, verbatim.
 */
export async function runRingoCore(args: readonly string[], input: Uint8Array): Promise<Uint8Array> {
  const argv = ["core", ...args];
  const stdout: Uint8Array[] = [];
  const stderr: Uint8Array[] = [];
  let memory!: WebAssembly.Memory;
  let read = 0;

  // Re-read on every call: growing the memory detaches the old buffer, and Go
  // grows it whenever the heap does.
  const view = () => new DataView(memory.buffer);
  const bytes = (ptr: number, len: number) => new Uint8Array(memory.buffer, ptr, len);
  const encoded = argv.map((a) => new TextEncoder().encode(`${a}\0`));

  /** Walk an iovec array: `count` pairs of (pointer, length). */
  const iovecs = (ptr: number, count: number): [number, number][] => {
    const v = view();
    return Array.from({ length: count }, (_, i) => [
      v.getUint32(ptr + i * 8, true),
      v.getUint32(ptr + i * 8 + 4, true),
    ]);
  };

  const host = (): Record<string, (...a: never[]) => number> => ({
    args_sizes_get(countPtr: number, sizePtr: number) {
      view().setUint32(countPtr, encoded.length, true);
      view().setUint32(sizePtr, encoded.reduce((n, a) => n + a.length, 0), true);
      return ESUCCESS;
    },
    args_get(argvPtr: number, bufPtr: number) {
      for (const [i, arg] of encoded.entries()) {
        view().setUint32(argvPtr + i * 4, bufPtr, true);
        bytes(bufPtr, arg.length).set(arg);
        bufPtr += arg.length;
      }
      return ESUCCESS;
    },
    // No environment: `core` takes everything it needs as argv and stdin.
    environ_sizes_get(countPtr: number, sizePtr: number) {
      view().setUint32(countPtr, 0, true);
      view().setUint32(sizePtr, 0, true);
      return ESUCCESS;
    },
    environ_get: () => ESUCCESS,
    clock_time_get(_id: number, _precision: bigint, timePtr: number) {
      view().setBigUint64(timePtr, BigInt(Math.round(performance.now() * 1e6)), true);
      return ESUCCESS;
    },
    random_get(ptr: number, len: number) {
      // Filled through a copy: getRandomValues refuses a view it thinks may be
      // shared, and is capped per call.
      for (let done = 0; done < len; done += RANDOM_CHUNK) {
        const chunk = crypto.getRandomValues(new Uint8Array(Math.min(RANDOM_CHUNK, len - done)));
        bytes(ptr + done, chunk.length).set(chunk);
      }
      return ESUCCESS;
    },
    fd_read(fd: number, iovsPtr: number, iovsLen: number, nreadPtr: number) {
      if (fd !== 0) return EBADF;
      let n = 0;
      for (const [ptr, len] of iovecs(iovsPtr, iovsLen)) {
        const take = Math.min(len, input.length - read);
        bytes(ptr, take).set(input.subarray(read, read + take));
        read += take;
        n += take;
      }
      // Zero bytes read is how WASI spells end-of-file.
      view().setUint32(nreadPtr, n, true);
      return ESUCCESS;
    },
    fd_write(fd: number, iovsPtr: number, iovsLen: number, nwrittenPtr: number) {
      if (fd !== 1 && fd !== 2) return EBADF;
      let n = 0;
      for (const [ptr, len] of iovecs(iovsPtr, iovsLen)) {
        // Copied out: the view is over memory the module goes on to reuse.
        (fd === 1 ? stdout : stderr).push(bytes(ptr, len).slice());
        n += len;
      }
      view().setUint32(nwrittenPtr, n, true);
      return ESUCCESS;
    },
    fd_fdstat_get(fd: number, statPtr: number) {
      if (fd > 2) return EBADF;
      // A character device with no flags set: blocking, which is what makes Go
      // read stdin with plain fd_read instead of parking on poll_oneoff.
      bytes(statPtr, 24).fill(0);
      view().setUint8(statPtr, 2);
      return ESUCCESS;
    },
    fd_fdstat_set_flags: () => ESUCCESS,
    fd_close: () => ESUCCESS,
    // No preopened directories. Go scans upward from fd 3 until it is told
    // this, so answering it is what ends the scan.
    fd_prestat_get: () => EBADF,
    fd_prestat_dir_name: () => EBADF,
    // Go sleeps through poll_oneoff. Every subscription is reported as having
    // fired at once: a sleep that returns early is still a correct sleep, and
    // there is nothing else in this process for the module to be waiting on.
    poll_oneoff(inPtr: number, outPtr: number, count: number, neventsPtr: number) {
      for (let i = 0; i < count; i++) {
        const userdata = view().getBigUint64(inPtr + i * 48, true);
        const tag = view().getUint8(inPtr + i * 48 + 8);
        bytes(outPtr + i * 32, 32).fill(0);
        view().setBigUint64(outPtr + i * 32, userdata, true);
        view().setUint8(outPtr + i * 32 + 10, tag);
      }
      view().setUint32(neventsPtr, count, true);
      return ESUCCESS;
    },
    sched_yield: () => ESUCCESS,
    proc_exit(code: number): never {
      throw new Exit(code);
    },
  });

  const instance = await WebAssembly.instantiate(await module(), {
    wasi_snapshot_preview1: host() as WebAssembly.ModuleImports,
  });
  memory = instance.exports.memory as WebAssembly.Memory;

  let code = 0;
  try {
    (instance.exports._start as () => void)();
  } catch (e) {
    if (!(e instanceof Exit)) throw e;
    code = e.code;
  }
  if (code !== 0) throw new RingoCoreError(args, code, new TextDecoder().decode(concat(stderr)));
  return concat(stdout);
}

function concat(chunks: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

/** A pane log replayed to its final scrollback. */
export interface PaneRender {
  /** One line per row, styled `<span>`s inside, every character escaped. */
  html: string;
  /** How many rows the replay ended with. */
  lines: number;
}

/**
 * Replay a raw tmux pane log — ringo's `core.RenderPaneLog`.
 *
 * It EMULATES a terminal rather than stripping escape codes: agent panes
 * repaint inline by moving the cursor up and erasing, so a real log is tens of
 * times longer than what it finally shows. ringo's renderer is deliberately
 * not a full VT (no scroll regions, no alternate screen, no tab stops, no
 * character sets); those limits are ringo's, stated in `core/paneterm.go`, and
 * they are not something to "complete" from this side.
 *
 * `raw` is bytes on purpose. tmux appends to the log with no locking, so a
 * read can end mid-escape-sequence or mid-UTF-8-sequence, and decoding it to a
 * string first would rewrite that torn tail before the renderer saw it.
 *
 * `maxLines` bounds the rows kept; zero or omitted takes ringo's default.
 */
export async function renderPaneLog(raw: Uint8Array, maxLines = 0): Promise<PaneRender> {
  const args = maxLines > 0 ? ["pane", String(Math.trunc(maxLines))] : ["pane"];
  return JSON.parse(new TextDecoder().decode(await runRingoCore(args, raw))) as PaneRender;
}

/** `core.ToolCall`, as `core transcript` marshals it. Times are RFC 3339; a zero time is year 1. */
export interface TranscriptToolCall {
  Name: string;
  Summary: string;
  Input: string;
  Output: string;
  IsError: boolean;
  Unpaired: boolean;
  OutBytes: number;
  StartedAt: string;
  EndedAt: string;
}

/** `core.Step`. */
export interface TranscriptStep {
  Kind: "text" | "thinking" | "tool" | "note";
  At: string;
  Text: string;
  Tool: TranscriptToolCall | null;
}

/** `core.Turn`. */
export interface TranscriptTurn {
  Prompt: string;
  At: string;
  Steps: TranscriptStep[] | null;
}

/** `core.Transcript`. `ToolTime` is nanoseconds, Go's `time.Duration`. */
export interface Transcript {
  SessionID: string;
  Title: string;
  Model: string;
  Branch: string;
  CWD: string;
  Version: string;
  FirstAt: string;
  LastAt: string;
  Turns: TranscriptTurn[] | null;
  ToolCounts: Record<string, number>;
  ToolCalls: number;
  ToolTime: number;
  Slowest: TranscriptToolCall[] | null;
  Errors: number;
  Cost: number;
  Skipped: number;
  /** Lines past ringo's 4 MiB line bound, skipped whole. */
  Oversized: number;
  Truncated: boolean;
}

/**
 * Read a JSONL session transcript back into turns — ringo's
 * `core.ParseTranscript`, the reader behind its transcript page. Synchronous
 * like the pane replay, so a caller bounds what it passes in.
 */
export async function parseTranscript(raw: Uint8Array, maxSteps = 0): Promise<Transcript> {
  const args = maxSteps > 0 ? ["transcript", String(Math.trunc(maxSteps))] : ["transcript"];
  return JSON.parse(new TextDecoder().decode(await runRingoCore(args, raw))) as Transcript;
}
