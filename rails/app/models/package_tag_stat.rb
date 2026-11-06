# `package_tag_stats`, written by the stats sync from each merged commit's
# `parity-outputs-<sha>` artifact (RFC 0222).
class PackageTagStat < Stats
  self.table_name = "package_tag_stats"
end
