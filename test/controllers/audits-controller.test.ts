import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getFs } from "@blazetrails/ruby-compat";
import { Trails } from "@blazetrails/trailties";
import { ApplicationController } from "../../app/controllers/application-controller.js";
import { AuditsController } from "../../app/controllers/audits-controller.js";
import {
  AUDIT_FILE_RE,
  auditTitle,
  auditsDir,
  isHtmlAudit,
  listAudits,
  readAudit,
} from "../../app/models/audit.js";
import { controllerTestCase } from "../support/controller-test-case.js";

/**
 * `/audits` and `/audits/view/<file>`, against a scratch audits directory.
 *
 * The directory sits INSIDE a parent holding a file of its own, so a
 * traversal that escaped would have something real to read.
 */
let parent: string;
let dir: string;

async function get(action: "index" | "show", params: Record<string, string> = {}) {
  const tc = await controllerTestCase(AuditsController);
  await tc.get(action, { params });
  return tc.response;
}

beforeAll(async () => {
  ApplicationController.prependViewPath("app/views");
  const fs = getFs();
  parent = await fs.mkdtemp!("/tmp/trailmap-audits-");
  dir = `${parent}/audits`;
  await fs.mkdir!(dir);
  await fs.writeFile!(`${parent}/secret.md`, "# outside the audits directory");
  await fs.writeFile!(`${dir}/.hidden.md`, "# a dotfile");
  await fs.writeFile!(`${dir}/notes.txt`, "not an audit");
  const files: [string, string, string][] = [
    ["older-audit-20260801T000000Z.md", "---\nkind: audit\n---\n# Older\n\nbody", "2026-08-01T00:00:00Z"],
    [
      "newer_audit.md",
      '# Newer\n\n<script>alert(1)</script> [x](javascript:alert(1)) <img src=x onerror=alert(1)>', "2026-09-01T00:00:00Z"],
    ["b-tie.html", "<!doctype html><p>raw html</p>", "2026-08-15T00:00:00Z"],
    ["a-tie.md", "# tie", "2026-08-15T00:00:00Z"],
  ];
  for (const [name, body, when] of files) {
    await fs.writeFile!(`${dir}/${name}`, body);
    fs.utimesSync!(`${dir}/${name}`, new Date(when), new Date(when));
  }
  Trails.application!.config.x.audits.dir = dir;
});

afterAll(async () => {
  Trails.application!.config.x.audits.dir = undefined;
  await getFs().rm!(parent, { recursive: true, force: true });
});

describe("AuditsController", () => {
  it("lists the audits newest first, ties in filename order, skipping other files", async () => {
    const body = (await get("index")).body;
    const order = [...body.matchAll(/href="\/audits\?file=([^"]+)"/g)].map((m) => decodeURIComponent(m[1]!));
    expect(order).toEqual(["newer_audit.md", "a-tie.md", "b-tie.html", "older-audit-20260801T000000Z.md"]);
    expect(body).toContain('src="/audits/view/newer_audit.md"');
  });

  it("selects the audit named in the query", async () => {
    const body = (await get("index", { file: "a-tie.md" })).body;
    expect(body).toContain('src="/audits/view/a-tie.md"');
  });

  it("renders a markdown audit into the shell, without its frontmatter", async () => {
    const response = await get("show", { file: "older-audit-20260801T000000Z.md" });
    expect(response.status).toBe(200);
    expect(response.body).toContain("<title>older audit</title>");
    expect(response.body).toContain("<h1>Older</h1>");
    expect(response.body).not.toContain("kind: audit");
    expect(response.body).not.toContain('<nav class="nav">');
  });

  it("escapes raw html and refuses a javascript: link in a markdown audit", async () => {
    const body = (await get("show", { file: "newer_audit.md" })).body;
    expect(body).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(body).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(body).not.toContain("<script>");
    expect(body).not.toContain('href="javascript:');
  });

  it("serves every audit sandboxed, and frames it sandboxed", async () => {
    for (const file of ["b-tie.html", "a-tie.md"]) {
      const response = await get("show", { file });
      expect(response.getHeader("Content-Security-Policy"), file).toBe("sandbox");
    }
    expect((await get("index")).body).toMatch(/<iframe sandbox src="\/audits\/view\//);
  });

  it("serves an html audit exactly as written", async () => {
    const response = await get("show", { file: "b-tie.html" });
    expect(response.status).toBe(200);
    expect(response.body).toBe("<!doctype html><p>raw html</p>");
  });

  it("refuses a path traversal and a dotfile before reading anything", async () => {
    for (const file of ["../secret.md", "..%2Fsecret.md", ".hidden.md", "audits/../../secret.md"]) {
      const response = await get("show", { file });
      expect(response.status, file).toBe(400);
      expect(response.body, file).toBe("bad audit name");
    }
  });

  it("answers 404 for a well-formed name with no file", async () => {
    const response = await get("show", { file: "missing.md" });
    expect(response.status).toBe(404);
  });
});

describe("auditFileRe", () => {
  it("is ringo's pattern", () => {
    for (const ok of ["a.md", "A-b_c.d.html", "0.md"]) expect(AUDIT_FILE_RE.test(ok), ok).toBe(true);
    for (const bad of [".x.md", "-x.md", "x.txt", "x/y.md", "x\\y.md", "x.md\n", "x.mdx", ".."]) {
      expect(AUDIT_FILE_RE.test(bad), bad).toBe(false);
    }
  });

  it("titles a file as ringo does", () => {
    expect(auditTitle("process-audit-20260803T134718Z.md")).toBe("process audit");
    expect(auditTitle("-20260803T134718Z.html")).toBe("-20260803T134718Z.html");
  });
});

describe("audit model", () => {
  it("reads AUDITS_DIR from config.x, without a trailing slash", () => {
    Trails.application!.config.x.audits.dir = `${dir}/`;
    try {
      expect(auditsDir()).toBe(dir);
    } finally {
      Trails.application!.config.x.audits.dir = dir;
    }
  });

  it("tells an html audit from a markdown one", () => {
    expect(isHtmlAudit("a.html")).toBe(true);
    expect(isHtmlAudit("a.md")).toBe(false);
  });

  it("reads one audit, and answers null for a missing file or a bad name", async () => {
    expect(await readAudit("a-tie.md")).toBe("# tie");
    expect(await readAudit("missing.md")).toBeNull();
    expect(await readAudit("../secret.md")).toBeNull();
  });

  it("lists nothing when the directory is unset or missing", async () => {
    Trails.application!.config.x.audits.dir = `${parent}/absent`;
    try {
      expect(await listAudits()).toEqual([]);
      Trails.application!.config.x.audits.dir = undefined;
      expect(await listAudits()).toEqual([]);
      expect(await readAudit("a-tie.md")).toBeNull();
    } finally {
      Trails.application!.config.x.audits.dir = dir;
    }
  });
});
