import type { ActionController } from "@blazetrails/actionpack";
import { included, isBlank, SecurityUtils } from "@blazetrails/activesupport";
import { env } from "@blazetrails/ruby-compat";

type IngestHost = Pick<ActionController.Base, "authenticateOrRequestWithHttpToken">;

/**
 * `include(this, IngestToken)` on an ingest create controller is
 * `before_action :require_ingest_token`, whose body is Rails'
 * `authenticate_or_request_with_http_token`
 * (`actionpack/lib/action_controller/metal/http_authentication.rb:466-470`):
 * a `Token` or `Bearer` credential is checked with
 * `ActiveSupport::SecurityUtils.secure_compare`, and anything else gets the
 * framework's 401 with its `WWW-Authenticate: Token realm="Application"`
 * challenge. An unset or empty `TRAILMAP_INGEST_TOKEN` refuses everything: the
 * endpoints fail closed on a box that was never provisioned.
 */
export const IngestToken = {
  [included](base: typeof ActionController.Base): void {
    base.beforeAction(":_requireIngestToken");
  },

  async _requireIngestToken(this: IngestHost): Promise<void> {
    const expected = env.TRAILMAP_INGEST_TOKEN;
    await this.authenticateOrRequestWithHttpToken(
      "Application",
      null,
      (token: string) => !isBlank(expected) && SecurityUtils.secureCompare(token, expected!),
    );
  },
};
