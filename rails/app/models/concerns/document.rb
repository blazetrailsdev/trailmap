# The markdown behind a record's `file_path`, read from the tasks checkout as
# ringo reads it. A failure is a VALUE, not a raise: the page renders the
# error inline and still shows the metadata.
module Document
  Body = Struct.new(:markdown, :error)

  module_function

  # The tasks checkout: TASKS_DIR, else two levels above TASKS_DATABASE
  # (`<checkout>/.git/tasks.db`), else nil.
  def tasks_content_dir
    dir = Rails.configuration.x.tasks.dir.to_s.strip
    return dir.sub(%r{/+\z}, "") if dir.present?
    db = ENV["TASKS_DATABASE"].to_s.strip
    db[%r{\A(.*)/\.git/[^/]+\z}, 1]
  end

  def read(file_path)
    return Body.new("", "") if file_path.blank?
    dir = tasks_content_dir
    if dir.nil?
      return Body.new("", "TASKS_DIR names no tasks checkout, so the markdown for #{file_path} cannot be read.")
    end
    Body.new(strip_frontmatter(File.read(File.join(dir, file_path), encoding: "UTF-8")), "")
  rescue SystemCallError => e
    Body.new("", node_style_message(e, File.join(dir, file_path)))
  end

  # Drop a leading `---` frontmatter block — ringo's `stripFrontmatter`,
  # construct for construct.
  def strip_frontmatter(source)
    s = source.delete_prefix("\uFEFF")
    return s.strip unless s.start_with?("---")
    rest = s[3..]
    idx = rest.index("\n---")
    return s.strip if idx.nil?
    after = rest[(idx + 4)..]
    nl = after.index("\n")
    nl.nil? ? "" : after[nl..].strip
  end

  # The error text Node's fs gives, so the page reads the same on both
  # (`ENOENT: no such file or directory, open '<path>'`).
  def node_style_message(error, path)
    code = error.class.name.split("::").last
    reason = error.message.sub(/ @ .*\z/m, "").sub(/ - .*\z/m, "")
    "#{code}: #{reason.downcase}, open '#{path}'"
  end
end
