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

  # The text, ringo's "unreadable" line for a missing file, or nil when
  # nothing is mounted or the name is not a bare file name.
  def self.read(log_file)
    name = File.basename(log_file.to_s)
    return nil if dir.nil? || !NAME.match?(name)
    path = File.join(dir, name)
    return File.read(path) if File.exist?(path)
    return Zlib::GzipReader.open("#{path}.gz", &:read) if File.exist?("#{path}.gz")
    "(pane log unreadable: #{path}: no such file or directory)"
  end
end
