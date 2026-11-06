# `package_meta`, written by the stats sync from each merged commit's
# `parity-outputs-<sha>` artifact (RFC 0222).
class PackageMeta < Stats
  self.table_name = "package_meta"
end
