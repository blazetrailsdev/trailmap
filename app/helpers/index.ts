import { ApplicationHelper } from "./application-helper.js";
import { MarkdownHelper } from "./markdown-helper.js";

/**
 * Every module under `app/helpers`, in the order they are included into
 * `ApplicationController`.
 *
 * Rails discovers these by globbing `app/helpers/**\/*_helper.rb` and
 * constantizing each basename (`AbstractController::Helpers::Resolution`,
 * which trails ports as `allHelpersFromPath`/`helperModulesFromPaths`). That
 * glob wants snake_case filenames and a constant registry to resolve them
 * against; trailmap names files in kebab-case and has no such registry, so the
 * list is written out here the way `app/models/index.ts` writes out the model
 * barrel. Adding a helper means adding it to this array.
 */
export const helperModules: readonly object[] = [ApplicationHelper, MarkdownHelper];
