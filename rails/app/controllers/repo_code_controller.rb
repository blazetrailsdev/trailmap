# `/:owner/:repo` — the code tab, which IS the repository page: the record,
# and the directories the repo's work cites, by first path segment.
class RepoCodeController < RepoController
  self.tab = "code"

  Directory = Struct.new(:name, :count)

  def show
    stories = RepoScope.stories_for(@repo.name)
    counts = RepoScope.paths_for(stories).map { |p| p.split("/").first.to_s }.reject(&:empty?).tally
    @story_count = stories.size
    @directories = StableSort.sort(counts.map { |name, count| Directory.new(name, count) }) do |a, b|
      (b.count <=> a.count).nonzero? || LocaleCompare.compare(a.name, b.name)
    end
  end
end
