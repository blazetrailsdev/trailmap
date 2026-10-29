require "json"
require "wasmtime"

# ringo's `core` package, run in-process: the same `vendor/ringo/core.wasm`
# the trails app runs (lib/ringo-core.ts), here through wasmtime's WASI. One
# implementation of the pane replay and the transcript reader, so the two
# apps cannot disagree about either.
#
# Each call is a fresh WASI command: argv and stdin in, stdout out, nothing
# shared between calls. The compiled module is kept.
module RingoCore
  WASM = File.expand_path("../vendor/ringo/core.wasm", __dir__)
  # stdout is collected in memory; past this the module's write fails.
  STDOUT_MAX = 256 << 20

  # `core` exited non-zero; the message is its stderr.
  class Error < StandardError; end

  class << self
    def run(args, input)
      stdout = +""
      stderr = +""
      wasi = Wasmtime::WasiConfig.new
        .set_argv(["core", *args])
        .set_stdin_string(input.b)
        .set_stdout_buffer(stdout, STDOUT_MAX)
        .set_stderr_buffer(stderr, 1 << 20)
      store = Wasmtime::Store.new(engine, wasi_p1_config: wasi)
      begin
        linker.instantiate(store, mod).invoke("_start")
      rescue Wasmtime::WasiExit => e
        raise Error, "ringo core #{args.join(' ')} exited #{e.code}: #{stderr.strip}" unless e.code.zero?
      end
      stdout
    end

    # ringo's `core.RenderPaneLog`: { "html" => ..., "lines" => N }.
    def render_pane_log(raw, max_lines = 0)
      JSON.parse(run(max_lines.positive? ? ["pane", max_lines.to_s] : ["pane"], raw))
    end

    # ringo's `core.ParseTranscript`, as `core transcript` marshals it.
    def parse_transcript(raw, max_steps = 0)
      JSON.parse(run(max_steps.positive? ? ["transcript", max_steps.to_s] : ["transcript"], raw))
    end

    private

    def engine
      @engine ||= Wasmtime::Engine.new
    end

    def mod
      @mod ||= Wasmtime::Module.from_file(engine, WASM)
    end

    def linker
      @linker ||= Wasmtime::Linker.new(engine).tap { |l| Wasmtime::WASI::P1.add_to_linker_sync(l) }
    end
  end
end
