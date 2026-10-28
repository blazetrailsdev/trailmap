# `/panes/<n>` — one agent's tmux pane, live and read-only.
class PanesController < ApplicationController
  def show
    id = params[:id].to_s
    return render plain: "Page not found", status: :not_found unless Fleet.pane_id?(id)
    @pane = "%#{id}"
    @screen_path = "#{Fleet::PANE_PATH}/#{id}/screen"
    @relay_configured = !Setting.ringo_base.nil?
  end
end
