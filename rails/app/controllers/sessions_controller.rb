# `/sessions`, `/sessions/:owner/:repo/:pr` and `/api/sessions`, read-only,
# beside ringo's own (`webhook/sessionarchive_page.go`), and the three file
# reads the rows link to: `file` relayed from ringo, `transcript` and `pane`
# drawn here by ringo's own reader and renderer (lib/ringo_core.rb).
class SessionsController < ApplicationController
  # The largest pane log is ~100 MB, and the clock runs until the last byte.
  ARCHIVE_FILE_TIMEOUT = 30
  # The most of one file relayed; past it ringo, which reads its own disk,
  # still serves it.
  ARCHIVE_FILE_MAX_BYTES = 128 << 20
  # The tail of a pane log replayed, and the rows kept: the trails app's bounds.
  PANE_VIEW_MAX_BYTES = 2 << 20
  PANE_VIEW_MAX_LINES = 20_000
  # The most of a transcript `transcript` parses: the head, cut back to the last
  # whole line. The parse holds the request for 60-130 ms per MB, so 4 MiB
  # keeps the worst one under half a second (see the trails controller).
  TRANSCRIPT_MAX_BYTES = 4 << 20
  # The steps one transcript page draws, ringo's `ParseTranscript(src, 20000)`.
  TRANSCRIPT_MAX_STEPS = 20_000
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
    @status = SessionArchive.status
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
    @timeline = SessionArchive.timeline(owner: @owner, repo: @repo, pr: @pr) if @archives.any?
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

  # ringo's `HandleTranscript`: the session read back into turns by ringo's
  # own `core.ParseTranscript`, drawn in this layout.
  def transcript
    no_store
    body = read_archive("/sessions/file", keep: :head_cut) or return
    @p = params[:p].to_s
    @max_bytes = TRANSCRIPT_MAX_BYTES
    @cut = body.bytesize > TRANSCRIPT_MAX_BYTES
    # A half line is a JSON error to ringo's reader; end on the last whole one.
    body = body.byteslice(0, (body.b.byteslice(0, TRANSCRIPT_MAX_BYTES).rindex("\n") || -1) + 1) if @cut
    # No newline in the whole head: its first line alone is past the bound.
    @first_line_too_long = @cut && body.empty?
    @tr = RingoCore.parse_transcript(body, TRANSCRIPT_MAX_STEPS)
  end

  # ringo's `HandlePaneView`: a pane log replayed to its final scrollback by
  # ringo's own terminal emulator. A transcript is sent to its own page.
  def pane
    no_store
    @p = params[:p].to_s
    if @p.include?(".jsonl") && self.class.archive_path_problem(@p).nil?
      return redirect_to sessions_transcript_path(p: @p)
    end
    read = read_archive("/sessions/file", keep: :tail) or return
    @bytes, @total = read
    @name = @p.split("/").last
    @max_bytes = PANE_VIEW_MAX_BYTES
    replay = RingoCore.render_pane_log(@bytes, PANE_VIEW_MAX_LINES)
    @html = replay["html"]
    @lines = replay["lines"]
  end

  private

  # Ask ringo for `path?p=`. nil when the answer has already been rendered: a
  # refused path, no ringo, ringo down, too large, or ringo's own refusal.
  # `keep: :tail` answers [the last PANE_VIEW_MAX_BYTES, total bytes] instead;
  # `keep: :head_cut` answers at most one byte past TRANSCRIPT_MAX_BYTES, never 413.
  def read_archive(path, keep: :head)
    p = params[:p].to_s
    problem = self.class.archive_path_problem(p)
    return render(plain: problem, status: :bad_request) && nil if problem
    base = Setting.ringo_base
    return render(plain: "no ringo origin is configured", status: :service_unavailable) && nil if base.nil?
    url = "#{base}#{path}?p=#{ERB::Util.url_encode(p)}"
    if keep == :tail
      answer, body, total = Fleet::Relay.get_tail(url, timeout: ARCHIVE_FILE_TIMEOUT, limit: PANE_VIEW_MAX_BYTES)
    elsif keep == :head_cut
      answer, body = Fleet::Relay.get_head(url, timeout: ARCHIVE_FILE_TIMEOUT, limit: TRANSCRIPT_MAX_BYTES + 1)
    else
      answer, body = Fleet::Relay.get_bounded(url, timeout: ARCHIVE_FILE_TIMEOUT, limit: ARCHIVE_FILE_MAX_BYTES)
    end
    unless answer.is_a?(Net::HTTPSuccess)
      # ringo's refusals are one line of text; anything longer is a proxy's page.
      text = body.to_s.strip
      code = answer.code.to_i
      render plain: text.empty? || text.length >= 500 ? "ringo answered #{code}" : text, status: code >= 400 ? code : 502
      return nil
    end
    if body.nil?
      render plain: "larger than trailmap relays (#{ARCHIVE_FILE_MAX_BYTES >> 20} MiB); ringo serves it whole", status: 413
      return nil
    end
    return [ body, total ] if keep == :tail
    body.dup.force_encoding(Encoding::UTF_8)
  rescue Fleet::Relay::Failure => e
    render plain: e.plain, status: e.status
    nil
  end
end
