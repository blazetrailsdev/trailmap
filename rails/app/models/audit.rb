# One agent-written progress report. On Base, with the report itself in
# Active Storage (RFC 0243, which reverses 0136's file-backed audits). The
# param is the filename the report had in the audits directory, so
# `/audits/<file>` keeps working.
class Audit < ApplicationRecord
  # ringo's `auditFileRe`, character for character. The route constraint
  # builds from it.
  FILE_RE = /\A[a-zA-Z0-9][a-zA-Z0-9._-]*\.(md|html)\z/
  SEGMENT = /[a-zA-Z0-9][a-zA-Z0-9._-]*\.(md|html)/
  PARAM_RE = /\A(.+)-(\d{8}T\d{6}Z)\.(md|html)\z/

  has_one_attached :body

  scope :newest_first, -> { order(written_at: :desc, id: :desc) }

  def self.find(name)
    slug, stamp, format = PARAM_RE.match(name.to_s)&.captures
    second = (Time.strptime(stamp, "%Y%m%dT%H%M%S%Z") rescue nil) if slug
    audit = find_by(slug: slug, format: format, written_at: second...(second + 1)) if second
    audit or raise ActiveRecord::RecordNotFound.new("Couldn't find Audit with 'name'=#{name}", name, "name", name)
  end

  def to_param = "#{slug}-#{written_at.utc.strftime("%Y%m%dT%H%M%SZ")}.#{format}"
  # The title the report gave, else its slug de-kebabbed, as ringo's `auditTitle`.
  def title = super.presence || slug.tr("-_", "  ")
  def when = written_at
  def html? = format == "html"
  def size = body.blob.byte_size
  def read = body.download.force_encoding(Encoding::UTF_8)
end
