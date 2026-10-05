/**
 * Where one page sits in a list, for any list served a page at a time.
 *
 * Not the backlog's: `shared/_pager` draws this shape and nothing in it knows
 * what the rows are, so the next paged list builds one here instead of
 * importing a type from a page controller.
 */
export interface Pager {
  page: number;
  pages: number;
  /** Rows in the whole list. */
  total: number;
  /** 1-based positions of the first and last row on this page; 0 when empty. */
  from: number;
  to: number;
  prevHref: string | null;
  nextHref: string | null;
}

/**
 * The page a request means. Digits only: `2abc`, `1e3` and `page[]=2` are not
 * page numbers, and `parseInt` would read a number out of each. Anything else
 * is the first page.
 */
export function requestedPage(param: unknown): number {
  return typeof param === "string" && /^\d+$/.test(param) ? Number.parseInt(param, 10) : 1;
}

/**
 * The pager for `total` rows at `size` a page. A page past the end is the last
 * page, not an empty one: a bookmarked `page=9` should not go blank because
 * the list got shorter.
 */
export function pagerFor(
  total: number,
  size: number,
  requested: number,
  hrefFor: (page: number) => string,
): Pager {
  const pages = Math.max(1, Math.ceil(total / size));
  const page = Math.min(Math.max(requested, 1), pages);
  const first = (page - 1) * size;
  const to = Math.min(first + size, total);
  return {
    page,
    pages,
    total,
    from: total === 0 ? 0 : first + 1,
    to,
    prevHref: page > 1 ? hrefFor(page - 1) : null,
    nextHref: page < pages ? hrefFor(page + 1) : null,
  };
}
