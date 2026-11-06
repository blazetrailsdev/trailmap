import { Trails } from "@blazetrails/trailties";

/**
 * A GET through the whole application — routes, middleware and the
 * framework's exception mapping — as Rails' `ActionDispatch::IntegrationTest`
 * makes one. A controller test calls the action directly, so it cannot see a
 * path that routes elsewhere, or a raise the middleware answers as a 500.
 */
export async function get(path: string): Promise<{ status: number; body: string }> {
  const [status, , body] = await Trails.application!.call({
    REQUEST_METHOD: "GET",
    PATH_INFO: path,
    HTTP_HOST: "localhost",
    HTTP_ACCEPT: "text/html",
    "action_dispatch.show_exceptions": "all",
    "rack.input": "",
  });
  let text = "";
  for await (const chunk of body as AsyncIterable<string>) text += chunk;
  return { status: Number(status), body: text };
}
