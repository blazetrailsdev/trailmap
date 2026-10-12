export const ApplicationHelper = {
  /**
   * The word a status badge shows, and the suffix of its `s-` class. A status
   * is whatever the record holds, so a null or blank one is `unknown` — the
   * arm ringo renders for a dep whose RFC is missing
   * (`webhook/story.go:551,684`).
   */
  statusWord(status: unknown): string {
    return String(status ?? "").trim() || "unknown";
  },
};
