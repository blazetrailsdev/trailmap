import { env, getFs, getHttpAsync } from "@blazetrails/ruby-compat";

/**
 * A stand-in ringo origin for screenshots: it answers the session archive's
 * endpoints from test/fixtures/ringo-archive, so `/sessions`, a PR's timeline
 * and a transcript render on a box with no ringo. Both apps read it:
 *
 *   pnpm ringo:stub                       # listens on 127.0.0.1:8399
 *   RINGO_BASE=http://127.0.0.1:8399 bin/trails server
 *   RINGO_BASE=http://127.0.0.1:8399 rails/bin/rails server
 *
 * `/sessions/file?p=<path>` serves `files/<path>`, slashes in a pane log's
 * path spelled `__` (`panes/42.log` is `files/panes__42.log`).
 */
const ROOT = "test/fixtures/ringo-archive";
const PORT = Number(env.RINGO_STUB_PORT ?? 8399);

async function answer(url: URL): Promise<{ status: number; type: string; body: string }> {
  const json = (name: string) => getFs().readFile(`${ROOT}/${name}`, "utf-8").then((body) => ({ status: 200, type: "application/json", body }));
  if (url.pathname === "/api/sessions") return json("sessions.json");
  if (url.pathname === "/api/sessions/status") return json("status.json");
  if (url.pathname === "/api/sessions/timeline") return json("timeline.json");
  if (url.pathname === "/sessions/file") {
    const p = url.searchParams.get("p") ?? "";
    const name = p.startsWith("panes/") ? p.replace("/", "__") : p;
    try {
      return { status: 200, type: "text/plain", body: await getFs().readFile(`${ROOT}/files/${name}`, "utf-8") };
    } catch {
      return { status: 404, type: "text/plain", body: `no fixture for ${p}` };
    }
  }
  return { status: 404, type: "text/plain", body: "not a stubbed ringo endpoint" };
}

const http = await getHttpAsync();
http
  .createServer(async (req, res) => {
    const { status, type, body } = await answer(new URL(req.url ?? "/", "http://stub"));
    res.writeHead(status, { "content-type": type });
    res.end(body);
  })
  .listen(PORT, "127.0.0.1", () => console.log(`ringo stub on http://127.0.0.1:${PORT}`));
