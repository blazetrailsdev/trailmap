import { ActionController } from "@blazetrails/actionpack";

export class ApplicationController extends ActionController.Base {
  /**
   * Where a controller's views live, in this repo's spelling:
   * `RfcPagesController` renders `app/views/rfc-pages/show`.
   *
   * trails derives the view prefix from `controllerPath`, which is Rails'
   * `underscore` — `rfc_pages` — while every other filename here is kebab-case.
   * This is the hook Rails documents for exactly that
   * (`action_view/view_paths.rb`, `local_prefixes`: "Override this method in
   * your controller if you want to change paths prefixes for finding views"),
   * and it changes the view lookup and nothing else.
   *
   * It is deliberately NOT a `controllerPath` override, which trailmap tried
   * first: `controllerPath` also names the controller in routes, where a
   * hyphen is illegal, so that made every page controller untestable through
   * `ActionController::TestCase`.
   */
  static localPrefixes(): string[] {
    return [this.controllerPath().replace(/_/g, "-")];
  }
}
