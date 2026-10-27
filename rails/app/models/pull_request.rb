# A merged trails PR, as the stats cron recorded it. Joined on
# `merge_commit_sha`, the comparison tables' only index.
class PullRequest < Stats
  self.primary_key = "number"
end
