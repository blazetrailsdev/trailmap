# `package_file_stats`, written by the stats sync from each merged commit's
# `parity-outputs-<sha>` artifact (RFC 0222).
class PackageFileStat < Stats
  self.table_name = "package_file_stats"
end
