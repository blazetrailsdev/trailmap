# `package_tag_sites`, written by the stats sync from each merged commit's
# `parity-outputs-<sha>` artifact (RFC 0222).
class PackageTagSite < Stats
  self.table_name = "package_tag_sites"
end
