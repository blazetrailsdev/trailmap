# `package_meta`, written by the stats sync from each merged commit's
# `parity-outputs-<sha>` artifact (RFC 0222).
class PackageMeta < Stats
  self.table_name = "package_meta"

  # The api:compare and test:compare keys this package's rows are written
  # under (`actionpack` -> actiondispatch, ...); NULL keys it by `package`.
  def compare_keys
    self[:compare_keys].presence&.split(",") || [ package ]
  end
end
