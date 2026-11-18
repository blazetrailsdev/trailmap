# The story page's formatting; the trails app's `StoryPagesHelper` has the same shape.
module StoryPagesHelper
  # The GitHub organization every `repo#N` PR ref names a repo in.
  GITHUB_ORG_URL = "https://github.com/blazetrailsdev".freeze

  # A PR ref as the tasks database writes `stories.pr`: `repo#N`.
  PR_REF = /\A([A-Za-z0-9_.-]+)#([0-9]+)\z/

  # The GitHub URL of a story's `repo#N` PR, or nil when the value is not a
  # ref the page can link (a legacy bare number); the page prints it as text.
  def pr_url(pr)
    m = PR_REF.match(pr.to_s)
    m ? "#{GITHUB_ORG_URL}/#{m[1]}/pull/#{m[2]}" : nil
  end

  # The PR as the story page shows it: a link when it is a ref, else text.
  def pr_link(pr)
    url = pr_url(pr)
    url ? link_to(pr, url, target: "_blank", rel: "noopener") : pr
  end
end
