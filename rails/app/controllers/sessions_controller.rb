# `/sessions`, `/sessions/:owner/:repo/:pr` and `/api/sessions`, read-only,
# beside ringo's own (`webhook/sessionarchive_page.go`), and the three file
# reads the rows link to: `file` and `transcript` relayed from ringo, `pane`
# not yet (DEVIATIONS.md, "the pane replay").
class SessionsController < ApplicationController
  # The largest pane log is ~100 MB, and the clock runs until the last byte.
  ARCHIVE_FILE_TIMEOUT = 30
  # The most of one file relayed; past it ringo, which reads its own disk,
  # still serves it.
  ARCHIVE_FILE_MAX_BYTES = 128 << 20
  # Stricter than ringo's `OpenPath`: refused before ringo is asked.
  ARCHIVE_SEGMENT = /\A[A-Za-z0-9_][A-Za-z0-9._@+-]*\z/

  # Why `p` is refused, or nil when it names an archive file.
  def self.archive_path_problem(p)
    return "missing p" if p.empty?
    return "path is too long" if p.length > 1024
    p.split("/", -1).each do |segment|
      return %(path "#{p}" has an empty segment) if segment.empty?
      return %(path "#{p}" escapes the archive root) if segment == "." || segment == ".."
      return %(path "#{p}" names a dotfile) if segment.start_with?(".")
      return %(path "#{p}" has a character the archive never writes) unless segment.match?(ARCHIVE_SEGMENT)
    end
    nil
  end

  def index
    no_store
    @now = Time.now
    @archives = SessionArchive.all
  rescue SessionArchive::Unavailable => e
    @archives = []
    @problem = e.message
  end

  # One PR's archives. An unknown PR is a 200 with "No archive recorded", not
  # a 404: that is what ringo's `servePR` answers.
  def show
    no_store
    @owner = params[:owner].to_s
    @repo = params[:repo].to_s
    @pr = params[:pr].to_i
    @now = Time.now
    @archives = SessionArchive.for_pr(owner: @owner, repo: @repo, pr: @pr)
  rescue SessionArchive::Unavailable => e
    @archives = []
    @problem = e.message
  end

  # ringo's `HandleSessionsAPI`: the index as JSON, in ringo's own shape.
  def api
    no_store
    render json: SessionArchive.all.map(&:row)
  rescue SessionArchive::Unavailable => e
    render plain: e.message, status: e.status
  end

  # ringo's `HandleSessionFile`: one archive file, gunzipped, as plain text.
  def file
    no_store
    body = read_archive("/sessions/file") or return
    name = params[:p].to_s.split("/").last.delete_suffix(".gz")
    response.headers["Content-Disposition"] = %(inline; filename="#{name}")
    render plain: body
  end

  # ringo's `HandleTranscript`, relayed. A whole document, so no layout; and
  # served on this origin, so sandboxed as the audit pages are.
  def transcript
    no_store
    body = read_archive("/sessions/transcript") or return
    response.headers["Content-Security-Policy"] = "sandbox"
    render html: body.html_safe, layout: false
  end

  # ringo's `HandlePaneView`. A transcript is sent to its own page, as ringo
  # does; a pane log needs ringo's renderer, which Ruby has no way to run.
  def pane
    no_store
    p = params[:p].to_s
    if p.include?(".jsonl") && self.class.archive_path_problem(p).nil?
      return redirect_to "/sessions/transcript?p=#{ERB::Util.url_encode(p)}"
    end
    problem = self.class.archive_path_problem(p)
    return render plain: problem, status: :bad_request if problem
    render plain: "pane replay is not ported to the Rails app (DEVIATIONS.md)", status: :not_implemented
  end

  private

  # Ask ringo for `path?p=`. nil when the answer has already been rendered: a
  # refused path, no ringo, ringo down, too large, or ringo's own refusal.
  def read_archive(path)
    p = params[:p].to_s
    problem = self.class.archive_path_problem(p)
    return render(plain: problem, status: :bad_request) && nil if problem
    base = Setting.ringo_base
    return render(plain: "no ringo origin is configured", status: :service_unavailable) && nil if base.nil?
    answer = Fleet::Relay.get("#{base}#{path}?p=#{ERB::Util.url_encode(p)}", timeout: ARCHIVE_FILE_TIMEOUT)
    unless answer.is_a?(Net::HTTPSuccess)
      # ringo's refusals are one line of text; anything longer is a proxy's page.
      text = answer.body.to_s.strip
      code = answer.code.to_i
      render plain: text.empty? || text.length >= 500 ? "ringo answered #{code}" : text, status: code >= 400 ? code : 502
      return nil
    end
    body = answer.body.to_s
    if body.bytesize > ARCHIVE_FILE_MAX_BYTES
      render plain: "larger than trailmap relays (#{ARCHIVE_FILE_MAX_BYTES >> 20} MiB); ringo serves it whole", status: 413
      return nil
    end
    body.dup.force_encoding(Encoding::UTF_8)
  rescue Fleet::Relay::Failure => e
    render plain: e.plain, status: e.status
    nil
  end
end
