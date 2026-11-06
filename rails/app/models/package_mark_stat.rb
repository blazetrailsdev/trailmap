# `package_mark_stats`, written by the stats sync from each merged commit's
# `parity-outputs-<sha>` artifact (RFC 0222).
class PackageMarkStat < Stats
  self.table_name = "package_mark_stats"
end
