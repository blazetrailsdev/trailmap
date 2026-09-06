import { AbstractController } from "@blazetrails/actionpack";
import { ApplicationController } from "../../app/controllers/application-controller.js";
import { helperModules } from "../../app/helpers/index.js";

/**
 * Include every module under `app/helpers` into `ApplicationController`.
 *
 * This is Rails' `include_all_helpers` initializer
 * (`ActionController::Railtie`), which is the link trails was missing: the
 * engine's `prepend_helpers_path` fills `config.helpersPaths` and nothing ever
 * read it, so `app/helpers` was unreachable from anywhere. Including into
 * `ApplicationController` rather than `ActionController::Base` keeps the
 * modules out of the framework's own class — every controller in this app
 * descends from `ApplicationController`, and `_helpers` is inherited.
 *
 * Reaching the VIEW is the other half; see `ApplicationController#lookupContext`.
 *
 * The work happens at import time because that is the whole contract for a
 * `config/initializers` file — `loadConfigInitializer` imports the module and
 * calls nothing. The named export exists for tests, which do not boot the
 * initializers.
 */
export function includeAllHelpers(): void {
  // `helper` takes a `HelpersClassMethods` — the `_helpers` / `_helperMethods`
  // class slots, all optional, which makes it a weak type TypeScript refuses to
  // match a controller class against. The slots are exactly what `helper`
  // writes, so the cast is a typing gap in the framework, not a shape mismatch.
  const target = ApplicationController as unknown as AbstractController.HelpersClassMethods;

  for (const mod of helperModules) {
    // Likewise `HelperMethodsModule` — `Record<string, (...args: unknown[]) =>
    // unknown>`, which no concretely-typed helper satisfies, since a helper
    // taking a `string` is not one taking `unknown`.
    AbstractController.helper(target, mod as AbstractController.HelperMethodsModule);
  }
}

includeAllHelpers();
