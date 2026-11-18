import { SafeBuffer, htmlEscape, htmlSafe } from "@blazetrails/activesupport";

/** The GitHub organization every `repo#N` PR ref names a repo in. */
export const GITHUB_ORG_URL = "https://github.com/blazetrailsdev";

/** A PR ref as the tasks database writes `stories.pr`: `repo#N`. */
const PR_REF = /^([A-Za-z0-9_.-]+)#([0-9]+)$/;

export const StoryPagesHelper = {
  /**
   * The GitHub URL of a story's `repo#N` PR, or null when the value is not a
   * ref the page can link (a legacy bare number); the page then prints it as
   * text. Rails' `pr_url` has the same shape.
   */
  prUrl(pr: string): string | null {
    const m = PR_REF.exec(pr);
    return m ? `${GITHUB_ORG_URL}/${m[1]}/pull/${m[2]}` : null;
  },

  /** The PR as the story page shows it: a link when it is a ref, else escaped text. Rails' `pr_link`. */
  prLink(pr: string): SafeBuffer {
    const url = StoryPagesHelper.prUrl(pr);
    const text = htmlEscape(pr);
    return htmlSafe(url === null ? String(text) : `<a target="_blank" rel="noopener" href="${htmlEscape(url)}">${text}</a>`);
  },
};
