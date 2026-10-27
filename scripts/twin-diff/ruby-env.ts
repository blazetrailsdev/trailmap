/**
 * How to run `ruby-ir.rb` against a given twin. Ruby 3.3's default Prism is
 * 0.19, which the IR builder outgrew (`ConstantPathNode#name` arrived in 1.0).
 * The twin's own bundle carries a current one: when `<twin>/Gemfile` exists,
 * Ruby runs under it, as `bundle exec` would, so the Prism is the one the twin
 * locks. CI's `rails` job installs that bundle (`bundler-cache`) outside the
 * system gems, so this is the only Prism ≥ 1.0 it has.
 */
import { env, getFs, getPath } from "@blazetrails/ruby-compat";

export interface RubyInvocation {
  /** arguments to put before the script */
  args: string[];
  /** the full child environment */
  env: Record<string, string | undefined>;
}

export function rubyFor(railsApp: string): RubyInvocation {
  const gemfile = getPath().join(railsApp, "..", "Gemfile");
  const base: Record<string, string | undefined> = { ...env };
  if (!getFs().existsSync(gemfile)) return { args: [], env: base };
  return {
    args: ["-rbundler/setup"],
    env: { ...base, BUNDLE_GEMFILE: gemfile },
  };
}
