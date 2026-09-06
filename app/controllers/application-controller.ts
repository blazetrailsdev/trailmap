import { AbstractController, ActionController, ActionView } from "@blazetrails/actionpack";
import { helperModules } from "../helpers/index.js";

/**
 * `LookupContext`'s memo for the class it builds view contexts from.
 *
 * The field is `private` in the published types and nothing sets it from
 * outside, so this cast is the seam. It records a framework gap rather than a
 * behaviour change: Rails builds the view context class on the CONTROLLER
 * (`ActionView::Rendering#view_context_class`) and hands it down, and trails'
 * own `@noRailsEquivalent CONVERGEABLE port-view-context-class-on-controller`
 * marks the same spot. When that converges, this override goes away.
 */
interface ViewContextClassMemo {
  _viewContextClass: typeof ActionView.Base | null;
}

export class ApplicationController extends ActionController.Base {
  /**
   * Splice this app's helpers into the view context.
   *
   * `ActionView::Base.withHelpers` is the `Class.new(klass) { include helpers }`
   * arm of Rails' `view_context_class` (`action_view/rendering.rb:59-73`).
   * Without it a compiled `.tse` — which runs its body under `with (this)` —
   * has no helper methods in scope at all, and `<%= renderMarkdown(body) %>`
   * raises `ReferenceError: renderMarkdown is not defined`.
   * `LookupContext#buildViewContext` otherwise builds the view from a bare
   * `withEmptyTemplateCache()`.
   *
   * The module handed over is the controller's `_helpers` — which carries the
   * framework's own helpers and anything `helperMethod` registered — with
   * `app/helpers` layered on top as OWN properties. The layering is not
   * decoration: `helper()` splices an included module in as a Proxy link whose
   * only traps are `get` and `has` (`abstract-controller/helpers.js`,
   * `makeIncludeLink`), so the descriptor copy `withHelpers` performs walks
   * straight past it and comes back empty. Including through `helper()` alone
   * — the shape this override would otherwise have — puts the methods on the
   * controller and still leaves the view without them.
   *
   * The memo is per lookup context and a lookup context is per controller
   * instance, so this neither shares nor invalidates a compiled-template cache
   * that was not already per request.
   */
  override get lookupContext(): ActionView.LookupContext {
    const context = super.lookupContext;
    const memo = context as unknown as ViewContextClassMemo;

    memo._viewContextClass ??= ActionView.Base.withHelpers(
      Object.assign(Object.create(AbstractController._helpersInstance.call(this)), ...helperModules),
    );

    return context;
  }
}
