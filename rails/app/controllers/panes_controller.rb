# `/panes/<n>` — one agent's tmux pane, live, with a box that types one line into it.
class PanesController < ApplicationController
  def show
    id = params[:id].to_s
    return render plain: "Page not found", status: :not_found unless Fleet.pane_id?(id)
    @pane = "%#{id}"
    @screen_path = "#{Fleet::PANE_PATH}/#{id}/screen"
    @send_path = "#{Fleet::PANE_PATH}/#{id}/send"
    @relay_configured = !Setting.ringo_base.nil?
  end
end
