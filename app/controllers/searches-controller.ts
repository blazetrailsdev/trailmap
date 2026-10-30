import { ApplicationController } from "./application-controller.ts";
import {
  SEARCH_MAX_LENGTH,
  SEARCH_MIN_LENGTH,
  search,
  withSnippets,
  searchPhrase,
  type SearchHit,
} from "../models/concerns/search.ts";
import { pagerFor, requestedPage } from "../models/concerns/pager.ts";

/** Results to a page. Each carries a body snippet, so fewer than the backlog's hundred. */
export const SEARCH_PAGE_SIZE = 50;

/**
 * `/search?q=` — stories and RFCs by id, title and body
 * (`app/models/concerns/search.ts` has the matching and the ranking).
 *
 * Surface ringo never had: nothing before this could answer "which stories
 * mention `serialize`". The page is the backlog's pager over a ranked list,
 * not a second pager.
 */
export class SearchesController extends ApplicationController {
  async show(): Promise<void> {
    const raw = this.params.get("q");
    const asked = typeof raw === "string" ? raw.trim() : "";
    const phrase = searchPhrase(raw);
    const hits: SearchHit[] = phrase === null ? [] : await search(phrase);

    const pager = pagerFor(
      hits.length,
      SEARCH_PAGE_SIZE,
      requestedPage(this.params.get("page")),
      // Not `searchPath({ q, page })`: that sorts `page` first and writes a space `+`.
      (page) => `${this.searchPath()}?q=${encodeURIComponent(phrase ?? "")}&page=${page}`,
    );
    const onPage = await withSnippets(
      hits.slice(pager.from === 0 ? 0 : pager.from - 1, pager.to),
      phrase ?? "",
    );

    await this.render({
      locals: {
        asked,
        phrase,
        tooShort: asked !== "" && phrase === null,
        minLength: SEARCH_MIN_LENGTH,
        maxLength: SEARCH_MAX_LENGTH,
        hits: onPage,
        pager,
      },
    });
  }
}
