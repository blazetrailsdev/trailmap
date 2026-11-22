import { describe, it, expect } from "vitest";
import { ActionController } from "@blazetrails/actionpack";
import { HomeController } from "../../app/controllers/home-controller.ts";
import { controllerTestCase } from "../support/controller-test-case.ts";

async function renderIndex(): Promise<string> {
  const tc = await controllerTestCase(HomeController);
  await tc.get("index");
  return tc.response.body;
}

describe("HomeController", () => {
  it("renders through the application layout", async () => {
    const body = await renderIndex();

    expect(body).toContain("<!DOCTYPE html>");
    // The logical name only: the test environment has no Vite manifest, so
    // the link is not asserted `/assets`-prefixed or digested here.
    // scripts/smoke-boot.sh is
    // the ONLY guard on the digested link and its cache header.
    expect(body).toMatch(/<link rel="stylesheet" href="\/vite-test\/assets\/application-[\w-]+\.css"/);
  });

  it("renders the nav bar, the task-domain links and the footer", async () => {
    const body = await renderIndex();

    expect(body).toContain('<nav class="nav">');
    expect(body).toContain('<a class="nav-brand" href="/">');
    expect(body).toContain('<a href="/rfcs">RFCs</a>');
    expect(body).toContain('<a href="/backlog">Backlog</a>');
    expect(body).toContain('<main class="site-main">');
    expect(body).toContain('<footer class="site-footer">');
  });

  it("carries the CSS-only mobile menu, so the shell needs no JavaScript", async () => {
    const body = await renderIndex();

    expect(body).toContain('<input type="checkbox" id="navToggle" class="nav-toggle">');
    expect(body).toContain('<label for="navToggle" class="nav-burger" aria-label="Menu">');
    // Turbo Drive's script is the only one; the menu works without it.
    expect(body.match(/<script[^>]*>/g)).toEqual([expect.stringMatching(/^<script src="\/vite-test\/assets\/application-[\w-]+\.js" type="module">$/)]);
  });

  it("renders a page, not the placeholder heading", async () => {
    const body = await renderIndex();

    expect(body).toContain("<h1>trailmap</h1>");
    expect(body).toContain("<h2>Pages</h2>");
    expect(body).toContain('<div class="box">');
    expect(body).toContain("<h2>Status vocabulary</h2>");
  });

  it("renders its statuses through the shared badge partial", async () => {
    const body = await renderIndex();

    expect(body).toContain('<span class="badge s-ready">ready</span>');
    expect(body).toContain('<span class="badge s-in-progress">in-progress</span>');
    expect(body).toContain('<span class="badge s-unknown">unknown</span>');
  });
});
