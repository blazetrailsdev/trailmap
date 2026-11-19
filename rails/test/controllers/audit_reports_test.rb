require "test_helper"

# `POST /audits`, ported from ../../test/controllers/audit-reports.test.ts.
class AuditReportsTest < ActionDispatch::IntegrationTest
  INGEST = { "HTTP_AUTHORIZATION" => "Bearer audit-test-token" }.freeze
  REPORT = { slug: "api-audit", repo: "blazetrailsdev/trails", body: "# Findings", writtenAt: "2026-11-19T10:20:30Z" }.freeze

  setup do
    @saved_token = ENV["TRAILMAP_INGEST_TOKEN"]
    ENV["TRAILMAP_INGEST_TOKEN"] = "audit-test-token"
  end

  teardown { ENV["TRAILMAP_INGEST_TOKEN"] = @saved_token }

  def report(body, headers = LOOPBACK.merge(INGEST))
    post "/audits", params: body.to_json, headers: headers.merge("CONTENT_TYPE" => "application/json")
    response.status == 401 ? nil : response.parsed_body
  end

  def stored(audit) = [ audit.body.filename.to_s, audit.body.content_type, audit.body.download ]

  test "stores a markdown report and answers its legacy filename" do
    body = report(REPORT.merge(title: "API audit"))

    assert_response :created
    assert_equal({ "id" => "api-audit-20261119T102030Z.md", "url" => "/audits/api-audit-20261119T102030Z.md" }, body)
    audit = Audit.find(body["id"])
    assert_equal "API audit", audit.title
    assert_equal "blazetrailsdev/trails", audit.repo
    assert_equal [ "api-audit-20261119T102030Z.md", "text/markdown", "# Findings" ], stored(audit)
  end

  test "stores an html report as text/html" do
    body = report(REPORT.merge(format: "html", body: "<p>hi</p>"))

    assert_response :created
    assert_equal "api-audit-20261119T102030Z.html", body["id"]
    assert_equal [ "api-audit-20261119T102030Z.html", "text/html", "<p>hi</p>" ], stored(Audit.find(body["id"]))
  end

  test "stamps a report with no writtenAt with the current second" do
    body = report(slug: "api-audit", repo: "blazetrailsdev/trails", body: "x")

    assert_response :created
    assert_match(/\Aapi-audit-\d{8}T\d{6}Z\.md\z/, body["id"])
  end

  test "answers the existing id for a report it already has" do
    first = report(REPORT)
    again = report(REPORT.merge(body: "# Different"))

    assert_response :ok
    assert_equal first["id"], again["id"]
    assert_equal 1, Audit.count
  end

  test "admits a 300 KB body" do
    big = "x" * (300 * 1024)
    body = report(REPORT.merge(body: big))

    assert_response :created
    assert_equal big.bytesize, Audit.find(body["id"]).size
  end

  test "refuses a bad slug, an unknown format, an empty body or a writtenAt that is not a time" do
    assert_equal({ "error" => "Slug must be kebab-case" }, report(REPORT.merge(slug: "Bad Slug")))
    assert_response :unprocessable_entity
    assert_equal({ "error" => "Format is not included in the list" }, report(REPORT.merge(format: "pdf")))
    assert_response :unprocessable_entity
    assert_equal({ "error" => "body must be a non-empty string" }, report(REPORT.merge(body: "")))
    assert_response :unprocessable_entity
    assert_equal({ "error" => "writtenAt must be a time" }, report(REPORT.merge(writtenAt: "soon")))
    assert_response :unprocessable_entity
    assert_equal 0, Audit.count
  end

  test "requires the ingest token" do
    report(REPORT, LOOPBACK)
    assert_response :unauthorized
    report(REPORT, LOOPBACK.merge("HTTP_AUTHORIZATION" => "Bearer wrong"))
    assert_response :unauthorized
    assert_equal 0, Audit.count
  end

  test "refuses a proxied request" do
    report(REPORT, LOOPBACK.merge(INGEST, "HTTP_X_FORWARDED_FOR" => "203.0.113.9"))

    assert_response :not_found
    assert_equal 0, Audit.count
  end
end
