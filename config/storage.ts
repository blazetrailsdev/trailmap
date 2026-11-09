/**
 * Active Storage services, Rails' `config/storage.yml`. `local` is where the
 * audit reports live: `storage/` is a dokku storage mount (docs/deploy.md), so
 * the blobs survive a deploy as the SQLite files beside them do.
 */
export default {
  local: {
    service: "Disk",
    root: "storage",
  },
  test: {
    service: "Disk",
    root: "tmp/storage",
  },
};
