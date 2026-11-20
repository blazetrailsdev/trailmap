/**
 * The one-time import of ringo's audits directory and refine reports, driven
 * through the real loopback controllers, twice.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { env, getFs, getPath } from "@blazetrails/ruby-compat";
import { Audit } from "../../app/models/audit.ts";
import { Refinement } from "../../app/models/refinement.ts";
import { Rfc } from "../../app/models/rfc.ts";
import { AuditReportsController } from "../../app/controllers/audit-reports-controller.ts";
import { RfcRefinesController } from "../../app/controllers/rfc-refines-controller.ts";
import { controllerTestCase } from "../support/controller-test-case.ts";
import { importReports, type Post } from "../../scripts/import-reports.ts";

const HEADERS = { Host: "127.0.0.1", Authorization: "Bearer import-test-token" };

const post: Post = async (route, body) => {
  const tc = await controllerTestCase(route === "/audits" ? AuditReportsController : RfcRefinesController, HEADERS);
  await tc.post("create", { body: JSON.stringify(body), as: "json" });
  return { status: tc.response.status, body: JSON.parse(tc.response.body) };
};

async function fixture(): Promise<string> {
  const [fs, path] = [getFs(), getPath()];
  await fs.mkdir!("tmp", { recursive: true });
  const data = await fs.mkdtemp!(path.join("tmp", "import-reports-"));
  const audits = path.join(data, "github", "blazetrailsdev", "trails", "audits");
  await fs.mkdir!(audits, { recursive: true });
  await fs.writeFile!(path.join(audits, "rule-drift-20260803T134718Z.md"), "# Drift\n");
  await fs.writeFile!(path.join(audits, "grade-card-20260804T010203Z.html"), "<p>card</p>");
  await fs.writeFile!(path.join(audits, "unstamped.md"), "# No stamp\n");
  await fs.writeFile!(path.join(audits, ".hidden.md"), "skipped");
  await fs.writeFile!(
    path.join(data, "refine-history.json"),
    JSON.stringify({
      "0001-alpha": [
        { when: "2026-08-01T10:00:00.123456789Z", outcome: "changed", summary: "first", stories: 4 },
        { when: "2026-08-02T10:00:00Z", outcome: "no-change", summary: "" },
      ],
    }),
  );
  await fs.writeFile!(
    path.join(data, "refines.json"),
    JSON.stringify({
      "0001-alpha": { when: "2026-08-02T10:00:00Z", outcome: "no-change", summary: "" },
      "0002-beta": { when: "2026-08-03T10:00:00Z", outcome: "aborted", summary: "only latest" },
    }),
  );
  return data;
}

describe("importReports", () => {
  beforeAll(() => {
    Object.assign(env, { TRAILMAP_INGEST_TOKEN: "import-test-token" });
  });
  afterAll(() => {
    Reflect.deleteProperty(env, "TRAILMAP_INGEST_TOKEN");
  });
  beforeEach(async () => {
    await Rfc.create({ id: "0001-alpha", status: "active", title: "Alpha" });
    await Rfc.create({ id: "0002-beta", status: "active", title: "Beta" });
  });

  it("imports every audit and the union of both refine files, and a re-run creates nothing", async () => {
    const data = await fixture();

    const first = await importReports(data, post);
    expect(first.audits).toEqual({ created: 3, existing: 0, failed: [] });
    expect(first.refinements).toEqual({ created: 3, existing: 0, failed: [] });

    const again = await importReports(data, post);
    expect(again.audits).toEqual({ created: 0, existing: 3, failed: [] });
    expect(again.refinements).toEqual({ created: 0, existing: 3, failed: [] });

    expect(await Audit.count()).toBe(3);
    const drift = await Audit.find("rule-drift-20260803T134718Z.md");
    expect(drift.repo).toBe("blazetrailsdev/trails");
    expect(await drift.read()).toBe("# Drift\n");
    expect((await Audit.find("grade-card-20260804T010203Z.html")).isHtml()).toBe(true);

    const refines = await Refinement.order({ created_at: "asc" }).toArray();
    expect(refines.map((r) => [r.rfc_id, r.created_at.utc().iso8601(3), r.outcome, r.stories])).toEqual([
      ["0001-alpha", "2026-08-01T10:00:00.123Z", "changed", 4],
      ["0001-alpha", "2026-08-02T10:00:00.000Z", "no-change", 0],
      ["0002-beta", "2026-08-03T10:00:00.000Z", "aborted", 0],
    ]);
  });
});
