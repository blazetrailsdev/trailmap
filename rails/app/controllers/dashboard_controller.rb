# `/dashboard` — the fleet dashboard, ported from ringo's `/`. Reads nothing
# from tasks.db: every row is Go-owned process state, streamed through the
# fleet relay.
class DashboardController < ApplicationController
  def index
    @repos = Repository.spawn_choices
    @socket_path = Fleet::SOCKET_PATH
    @control_path = Fleet::CONTROL_PATH
    @reviewers_path = Fleet::REVIEWERS_PATH
    @read_path = Fleet::READ_PATH
    @relay_configured = !Setting.ringo_base.nil?
  end
end
