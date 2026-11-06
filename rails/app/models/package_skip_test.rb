# `package_skip_tests`, written by the stats sync from each merged commit's
# `parity-outputs-<sha>` artifact (RFC 0222).
class PackageSkipTest < Stats
  self.table_name = "package_skip_tests"
end
