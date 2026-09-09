import { ActionController } from "@blazetrails/actionpack";

export class ApplicationController extends ActionController.Base {
  /**
   * The view prefix, in this repo's spelling: `app/views/rfc-pages/`.
   *
   * trails derives the prefix with Rails' `underscore`, so `RfcPagesController`
   * would look under `app/views/rfc_pages/`. trailmap is kebab-case in every
   * other filename, and one snake_case exception in `app/views` is the wrong
   * way round — so the derivation is overridden here, once, and every page
   * controller renders implicitly with no `template:` argument.
   *
   * This is the sanctioned extension point, not a reach into internals.
   * `controllerPath` is a public static exactly as Rails' `controller_path` is
   * (`abstract_controller/base.rb:127`), `ActionView`'s prefix lookup reads it
   * through that method (`localPrefixes`, `actionview/src/view-paths.ts`), and
   * the framework's own suites subclass it the same way
   * (`view-paths.trails.test.ts`). Nothing private is touched and no framework
   * behaviour is re-implemented — the base derivation still runs, and only its
   * separator is respelled.
   *
   * `derive-kebab-case-view-prefixes` (RFC 0140) proposes making this the
   * framework's own spelling. If it lands, delete this method; the suite in
   * `test/views/view-directory-names.test.ts` is what will notice.
   */
  static controllerPath(): string {
    return super.controllerPath().replace(/_/g, "-");
  }
}
