/** `POST /audits`, the loopback endpoint that stores an audit agent's report. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { env } from "@blazetrails/ruby-compat";
import { Audit } from "../../app/models/audit.ts";
import { AuditReportsController } from "../../app/controllers/audit-reports-controller.ts";
import { controllerTestCase } from "../support/controller-test-case.ts";

const LOOPBACK = { Host: "127.0.0.1" };
const INGEST = { Authorization: "Bearer audit-test-token" };

async function report(body: Record<string, unknown>, headers: Record<string, string> = { ...LOOPBACK, ...INGEST }) {
  const tc = await controllerTestCase(AuditReportsController, headers);
  // A raw body: `as: "json"` writes `format` into the params, over the report's own.
  await tc.post("create", { body: JSON.stringify(body), as: "json" });
  const json = tc.response.status === 401 ? null : JSON.parse(tc.response.body);
  return { status: tc.response.status, body: json };
}

async function stored(audit: Audit): Promise<[string, string, string]> {
  const blob = (await (await audit.body.attachment)!.blob)!;
  return [blob.filename.toString(), blob.content_type!, new TextDecoder().decode(await blob.download())];
}

const REPORT = { slug: "api-audit", repo: "blazetrailsdev/trails", body: "# Findings", writtenAt: "2026-11-19T10:20:30Z" };

describe("AuditReports", () => {
  let savedToken: string | undefined;
  beforeAll(() => {
    savedToken = env.TRAILMAP_INGEST_TOKEN;
    Object.assign(env, { TRAILMAP_INGEST_TOKEN: "audit-test-token" });
  });
  afterAll(() => {
    if (savedToken === undefined) Reflect.deleteProperty(env, "TRAILMAP_INGEST_TOKEN");
    else Object.assign(env, { TRAILMAP_INGEST_TOKEN: savedToken });
  });

  it("stores a markdown report and answers its legacy filename", async () => {
    const { status, body } = await report({ ...REPORT, title: "API audit" });

    expect(status).toBe(201);
    expect(body).toEqual({ id: "api-audit-20261119T102030Z.md", url: "/audits/api-audit-20261119T102030Z.md" });
    const audit = await Audit.find(body.id);
    expect(audit.title).toBe("API audit");
    expect(audit.repo).toBe("blazetrailsdev/trails");
    expect(await stored(audit)).toEqual(["api-audit-20261119T102030Z.md", "text/markdown", "# Findings"]);
  });

  it("stores an html report as text/html", async () => {
    const { status, body } = await report({ ...REPORT, format: "html", body: "<p>hi</p>" });

    expect(status).toBe(201);
    expect(body.id).toBe("api-audit-20261119T102030Z.html");
    expect(await stored(await Audit.find(body.id))).toEqual(["api-audit-20261119T102030Z.html", "text/html", "<p>hi</p>"]);
  });

  it("stamps a report with no writtenAt with the current second", async () => {
    const { status, body } = await report({ slug: "api-audit", repo: "blazetrailsdev/trails", body: "x" });

    expect(status).toBe(201);
    expect(body.id).toMatch(/^api-audit-\d{8}T\d{6}Z\.md$/);
  });

  it("answers the existing id for a report it already has", async () => {
    const first = await report(REPORT);
    const again = await report({ ...REPORT, body: "# Different" });

    expect(again.status).toBe(200);
    expect(again.body.id).toBe(first.body.id);
    expect(await Audit.count()).toBe(1);
  });

  it("admits a 300 KB body", async () => {
    const big = "x".repeat(300 * 1024);
    const { status, body } = await report({ ...REPORT, body: big });

    expect(status).toBe(201);
    expect(await (await Audit.find(body.id)).size()).toBe(big.length);
  });

  it("refuses a bad slug, an unknown format, an empty body or a writtenAt that is not a time", async () => {
    expect(await report({ ...REPORT, slug: "Bad Slug" })).toEqual({ status: 422, body: { error: "Slug must be kebab-case" } });
    expect(await report({ ...REPORT, format: "pdf" })).toEqual({ status: 422, body: { error: "Format is not included in the list" } });
    expect(await report({ ...REPORT, body: "" })).toEqual({ status: 422, body: { error: "body must be a non-empty string" } });
    expect(await report({ ...REPORT, repo: "" })).toEqual({ status: 422, body: { error: "repo must be given" } });
    expect(await report({ ...REPORT, writtenAt: "soon" })).toEqual({ status: 422, body: { error: "writtenAt must be a time" } });
    expect(await Audit.count()).toBe(0);
  });

  it("requires the ingest token", async () => {
    expect((await report(REPORT, LOOPBACK)).status).toBe(401);
    expect((await report(REPORT, { ...LOOPBACK, Authorization: "Bearer wrong" })).status).toBe(401);
    expect(await Audit.count()).toBe(0);
  });

  it("refuses a proxied request", async () => {
    const { status } = await report(REPORT, { ...LOOPBACK, ...INGEST, "X-Forwarded-For": "203.0.113.9" });

    expect(status).toBe(404);
    expect(await Audit.count()).toBe(0);
  });

  it("lists every audit newest first without its body, and needs no token", async () => {
    await report(REPORT);
    await report({ ...REPORT, slug: "later-audit", writtenAt: "2026-11-20T00:00:00Z", format: "html", body: "<p>x</p>" });
    const tc = await controllerTestCase(AuditReportsController, LOOPBACK);
    await tc.get("index");

    expect(tc.response.status).toBe(200);
    expect(JSON.parse(tc.response.body)).toEqual([
      { name: "later-audit-20261120T000000Z.html", repo: "blazetrailsdev/trails", slug: "later-audit", title: "later audit", format: "html", when: "2026-11-20T00:00:00Z" },
      { name: "api-audit-20261119T102030Z.md", repo: "blazetrailsdev/trails", slug: "api-audit", title: "api audit", format: "md", when: "2026-11-19T10:20:30Z" },
    ]);
  });
});
