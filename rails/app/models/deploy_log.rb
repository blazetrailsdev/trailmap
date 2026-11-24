require "zlib"

# One deploy run's log, read from DEPLOY_LOGS_DIR — ringo's pane-log
# directory, mounted read-only — rather than through ringo. Raw first, then
# the `.gz` ringo's sweep leaves, as `DeployStore.LogText` reads them; every
# finished run's file is already there, which is the backfill.
module DeployLog
  NAME = /\A[A-Za-z0-9][A-Za-z0-9._%-]*\z/

  def self.dir
    Rails.configuration.x.deploys.logs_dir.to_s.strip.sub(%r{/+\z}, "").presence
  end

  # Whether `log_file` is read off the mount: one is mounted, and the name is
  # a bare file name. Otherwise the controller relays ringo.
  def self.local?(log_file)
    dir.present? && NAME.match?(File.basename(log_file.to_s))
  end

  # The text, or ringo's "unreadable" line for a missing file. Ask `local?` first.
  def self.read(log_file)
    path = File.join(dir, File.basename(log_file.to_s))
    return File.read(path) if File.exist?(path)
    return Zlib::GzipReader.open("#{path}.gz", &:read) if File.exist?("#{path}.gz")
    "(pane log unreadable: #{path}: no such file or directory)"
  end

  # The log replayed through ringo's terminal emulator, within the bounds the
  # caller passes (the pane view's): the tail of the capture, at most its rows
  # kept. An emulator failure comes back as a `:problem` to answer in plain
  # text, as a relay failure is.
  def self.screen(bytes, max_bytes, max_lines, render: RingoCore.method(:render_pane_log))
    bytes = bytes.b
    bytes = bytes.byteslice(-max_bytes, max_bytes) if bytes.bytesize > max_bytes
    { html: render.call(bytes, max_lines)["html"] }
  rescue StandardError => e
    { problem: "log not rendered: #{e.message}" }
  end
end
