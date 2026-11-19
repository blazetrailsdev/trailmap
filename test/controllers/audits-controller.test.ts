import { beforeEach, describe, expect, it } from "vitest";
import { StringIO } from "@blazetrails/ruby-compat";
import { AuditsController } from "../../app/controllers/audits-controller.ts";
import { RecordNotFound } from "@blazetrails/activerecord";
import { AUDIT_FILE_RE, Audit } from "../../app/models/audit.ts";
import { controllerTestCase } from "../support/controller-test-case.ts";

/** `/audits`, `/audits/<file>` and `/audits/<file>/raw`, over audits with attached bodies. */
async function get(action: "index" | "show" | "raw", params: Record<string, string> = {}) {
  const tc = await controllerTestCase(AuditsController);
  await tc.get(action, { params });
  return tc.response;
}


beforeEach(async () => {
  const audits: [string, string, "md" | "html", string, string][] = [
    ["older-audit", "older audit", "md", "---\nkind: audit\n---\n# Older\n\nbody", "2026-08-01T00:00:00Z"],
    [
      "newer-audit",
      "newer audit",
      "md",
      "# Newer\n\n<script>alert(1)</script> [x](javascript:alert(1)) <img src=x onerror=alert(1)>",
      "2026-09-01T00:00:00Z",
    ],
    ["b-tie", "b tie", "html", "<!doctype html><p>raw html</p>", "2026-08-15T00:00:00Z"],
    ["a-tie", "a tie", "md", "# tie", "2026-08-15T00:00:00Z"],
  ];
  for (const [slug, title, format, body, writtenAt] of audits) {
    const audit = await Audit.create({ slug, title, format, repo: "blazetrailsdev/trails", written_at: writtenAt });
    await audit.body.attach({
      io: new StringIO(body),
      filename: `${slug}.${format}`,
      contentType: format === "md" ? "text/markdown" : "text/html",
    });
  }
});

describe("AuditsController", () => {
  it("lists the audits newest first, ties newest-created first", async () => {
    const body = (await get("index")).body;
    const order = [...body.matchAll(/href="\/audits\/([^"]+)"/g)].map((m) => decodeURIComponent(m[1]!));
    expect(order).toEqual([
      "newer-audit-20260901T000000Z.md",
      "a-tie-20260815T000000Z.md",
      "b-tie-20260815T000000Z.html",
      "older-audit-20260801T000000Z.md",
    ]);
    expect(body).toContain('<article class="markdown audits-doc">');
    expect(body).not.toContain("<iframe");
  });

  it("renders a markdown audit inline, escaped", async () => {
    const body = (await get("show", { id: "newer-audit-20260901T000000Z.md" })).body;
    expect(body).toContain("<h1>Newer</h1>");
    expect(body).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(body).not.toContain("<iframe");
  });

  it("frames an html audit, sandboxed, rather than inlining it", async () => {
    const body = (await get("show", { id: "b-tie-20260815T000000Z.html" })).body;
    expect(body).toContain('<iframe sandbox src="/audits/b-tie-20260815T000000Z.html/raw"');
    expect(body).not.toContain("raw html");
  });

  it("opens the audit its own url names", async () => {
    const body = (await get("show", { id: "a-tie-20260815T000000Z.md" })).body;
    expect(body).toContain("<h1>tie</h1>");
    expect(body).toMatch(/class="audit-item active" href="\/audits\/a-tie-20260815T000000Z.md"/);
  });

  it("404s an audit url the list does not hold", async () => {
    // A malformed name never gets here — the route refuses it (test/routes.test.ts).
    await expect(get("show", { id: "missing-20260815T000000Z.md" })).rejects.toThrow(RecordNotFound);
  });

  it("renders a markdown audit into the shell, without its frontmatter", async () => {
    const response = await get("raw", { id: "older-audit-20260801T000000Z.md" });
    expect(response.status).toBe(200);
    expect(response.body).toContain("<title>older audit</title>");
    expect(response.body).toContain("<h1>Older</h1>");
    expect(response.body).not.toContain("kind: audit");
    expect(response.body).not.toContain('<nav class="nav">');
  });

  it("escapes raw html and refuses a javascript: link in a markdown audit", async () => {
    const body = (await get("raw", { id: "newer-audit-20260901T000000Z.md" })).body;
    expect(body).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(body).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(body).not.toContain("<script>");
    expect(body).not.toContain('href="javascript:');
  });

  it("serves every audit sandboxed, and frames it sandboxed", async () => {
    for (const file of ["b-tie-20260815T000000Z.html", "a-tie-20260815T000000Z.md"]) {
      const response = await get("raw", { id: file });
      expect(response.getHeader("Content-Security-Policy"), file).toBe("sandbox");
    }
  });

  it("serves an html audit exactly as written", async () => {
    const response = await get("raw", { id: "b-tie-20260815T000000Z.html" });
    expect(response.status).toBe(200);
    expect(response.body).toBe("<!doctype html><p>raw html</p>");
  });

  it("404s a well-formed name with no audit", async () => {
    await expect(get("raw", { id: "missing-20260815T000000Z.md" })).rejects.toThrow(RecordNotFound);
  });
});

describe("auditFileRe", () => {
  it("is ringo's pattern", () => {
    for (const ok of ["a.md", "A-b_c.d.html", "0.md"]) expect(AUDIT_FILE_RE.test(ok), ok).toBe(true);
    for (const bad of [".x.md", "-x.md", "x.txt", "x/y.md", "x\\y.md", "x.md\n", "x.mdx", ".."]) {
      expect(AUDIT_FILE_RE.test(bad), bad).toBe(false);
    }
  });
});

describe("Audit", () => {
  it("is a record on Base with an attached body", async () => {
    const audit = await Audit.find("a-tie-20260815T000000Z.md");
    expect(audit).toBeInstanceOf(Audit);
    expect(audit.isPersisted()).toBe(true);
    expect(audit.title).toBe("a tie");
    expect(await audit.size()).toBe(5);
    expect(audit.when.utc().iso8601()).toBe("2026-08-15T00:00:00Z");
    expect(Audit.modelName.name).toBe("Audit");
  });

  it("orders newest first, ties in id order", async () => {
    expect((await Audit.newestFirst().toArray()).map((a) => a.toParam())).toEqual([
      "newer-audit-20260901T000000Z.md",
      "a-tie-20260815T000000Z.md",
      "b-tie-20260815T000000Z.html",
      "older-audit-20260801T000000Z.md",
    ]);
  });

  it("finds by the legacy filename, raising RecordNotFound", async () => {
    expect((await Audit.find("b-tie-20260815T000000Z.html")).slug).toBe("b-tie");
    for (const name of ["missing-20260815T000000Z.md", "b-tie-20260815T000000Z.md", "a-tie.md", "../secret.md"]) {
      const error = await Audit.find(name).catch((e: unknown) => e);
      expect(error, name).toBeInstanceOf(RecordNotFound);
      expect((error as RecordNotFound).message).toBe(`Couldn't find Audit with 'name'=${name}`);
      expect(error).toMatchObject({ model: "Audit", primaryKey: "name", id: name });
    }
  });

  it("answers its filename as its param, and whether it is html", async () => {
    const html = await Audit.find("b-tie-20260815T000000Z.html");
    expect(html.toParam()).toBe("b-tie-20260815T000000Z.html");
    expect(html.isHtml()).toBe(true);
    expect((await Audit.find("older-audit-20260801T000000Z.md")).isHtml()).toBe(false);
  });

  it("titles an audit with no title from its slug", async () => {
    const audit = await Audit.create({ slug: "parity-sweep", format: "md", written_at: "2026-10-27T10:15:00Z" });
    expect(audit.title).toBe("parity sweep");
  });

  it("finds an audit written at a fraction of a second by the second its name stamps", async () => {
    await Audit.create({ slug: "precise", title: "p", format: "md", written_at: "2026-10-27T10:15:00.750Z" });
    expect((await Audit.find("precise-20261027T101500Z.md")).slug).toBe("precise");
  });

  it("reads its body", async () => {
    expect(await (await Audit.find("a-tie-20260815T000000Z.md")).read()).toBe("# tie");
  });
});
