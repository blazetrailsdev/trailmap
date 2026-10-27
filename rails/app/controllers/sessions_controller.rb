# `/sessions`, `/sessions/:owner/:repo/:pr` and `/api/sessions`, read-only,
# beside ringo's own (`webhook/sessionarchive_page.go`).
class SessionsController < ApplicationController
  def index
    no_store
    @archives = []
    @problem = nil
    @now = Time.now
    @archives = SessionArchive.all
  rescue SessionArchive::Unavailable => e
    @problem = e.message
  end

  # One PR's archives. An unknown PR is a 200 with "No archive recorded", not
  # a 404: that is what ringo's `servePR` answers.
  def show
    no_store
    @owner = params[:owner].to_s
    @repo = params[:repo].to_s
    @pr = params[:pr].to_i
    @archives = []
    @problem = nil
    @now = Time.now
    @archives = SessionArchive.for_pr(owner: @owner, repo: @repo, pr: @pr)
  rescue SessionArchive::Unavailable => e
    @problem = e.message
  end

  # ringo's `HandleSessionsAPI`: the index as JSON, in ringo's own shape.
  def api
    no_store
    render json: SessionArchive.all.map(&:row)
  rescue SessionArchive::Unavailable => e
    render plain: e.message, status: e.status
  end
end
