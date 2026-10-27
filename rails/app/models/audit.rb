# One agent-written progress report in AUDITS_DIR. An ActiveModel, not a
# record: the "table" is a directory and the primary key is the filename.
# Finders are shaped like Active Record's, `find` raising RecordNotFound.
class Audit
  include ActiveModel::Model
  include ActiveModel::Attributes

  # ringo's `auditFileRe`, character for character. The route constraint
  # builds from it.
  FILE_RE = /\A[a-zA-Z0-9][a-zA-Z0-9._-]*\.(md|html)\z/
  SEGMENT = /[a-zA-Z0-9][a-zA-Z0-9._-]*\.(md|html)/
  TS_SUFFIX_RE = /[-_]?\d{8}T\d{6}Z\z/

  attribute :name, :string
  attribute :size, :integer
  attribute :when, :datetime

  class << self
    def dir
      Rails.configuration.x.audits.dir.to_s.strip.sub(%r{/+\z}, "").presence
    end

    # Every audit, newest first; ties keep filename order.
    def all
      return [] if dir.nil?
      names = Dir.children(dir).sort
      audits = names.filter_map do |name|
        next unless FILE_RE.match?(name)
        stat = File.stat(File.join(dir, name))
        next if stat.directory?
        new(name: name, size: stat.size, when: Time.at(stat.mtime.to_i).utc)
      rescue SystemCallError
        nil
      end
      StableSort.sort(audits) { |a, b| b.when <=> a.when }
    rescue Errno::ENOENT
      []
    end

    def first
      all.first
    end

    def find_by(name:)
      return nil unless FILE_RE.match?(name)
      all.find { |a| a.name == name }
    end

    def find(name)
      find_by(name: name) or raise ActiveRecord::RecordNotFound.new("Couldn't find Audit with 'name'=#{name}", name, "name", name)
    end

    # ringo's `auditTitle`: drop extension and timestamp, de-kebab the slug.
    def title_for(name)
      base = name.delete_suffix(".md").delete_suffix(".html").sub(TS_SUFFIX_RE, "").tr("-_", "  ").strip
      base.empty? ? name : base
    end
  end

  def id = name
  def to_param = name
  def persisted? = true
  def title = self.class.title_for(name)
  def html? = name.end_with?(".html")

  def read
    raise ActiveRecord::RecordNotFound, "Couldn't find Audit with 'name'=#{name}" if self.class.dir.nil?
    File.read(File.join(self.class.dir, name), encoding: "UTF-8")
  rescue Errno::ENOENT
    raise ActiveRecord::RecordNotFound, "Couldn't find Audit with 'name'=#{name}"
  end
end
