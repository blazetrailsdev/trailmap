/**
 * THE CLASS-COLLISION RULE, shared by the source scan
 * (`test/assets/class-collisions.test.ts`), the rendered pages
 * (`test/views/rendered-class-collisions.test.ts`) and the dashboard's live DOM
 * (`scripts/dashboard-e2e.ts`).
 *
 * A class with a rule of its own setting `padding`, `display` or `position`
 * lays out a box; an element wearing two of them is two components on one
 * node, unless the pair is a deliberate modifier. trailmap#47 gave the reviewer
 * row's empty cell `class="pcell empty"` while `.empty` was the list pages'
 * empty-state block, so every reviewer line inherited 32px of padding.
 *
 * A compound rule (`.pcell.unassigned`) is the stylesheet saying that pair is
 * one component, so it makes the pair deliberate. A descendant or child rule
 * (`.card .btn`) lays out its LAST class's box in that context, so that class
 * counts as a box class. A compound box worn beside another box class is a
 * collision too: `.a.b` and `.c` on one element are two boxes. A type, id, attribute or pseudo-class in the compound
 * (`button.a`, `.a:hover`) still makes its one class a box class.
 */
export const STYLESHEET = "app/assets/stylesheets/application.css";

/** Pairs that are one component and its modifier, each naming why. */
export const DELIBERATE = new Set([
  "btn btn-sm", // `.btn-sm` is `.btn` with less padding.
]);

/** What the stylesheet says about boxes: the classes that lay one out, and the pairs it composes. */
export interface BoxRules {
  box: Set<string>;
  composed: Set<string>;
  /** Each compound rule's classes, sorted: a box of its own on an element wearing them all. */
  units: string[][];
}

export function boxRules(css: string): BoxRules {
  const box = new Set<string>();
  const composed = new Set<string>();
  const units = new Map<string, string[]>();
  const rules = css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g);
  for (const [, selectors, body] of rules) {
    if (!/(^|;)\s*(padding|display|position)\s*:/.test(body!)) continue;
    for (const selector of selectors!.split(",")) {
      // The compound the rule styles: the last one, after any combinator.
      const last = selector.trim().split(/\s*[\s>+~]\s*/).pop() ?? "";
      // Pseudo-classes, attribute tests and a type (`button.a`) narrow which
      // elements the rule reaches, not which class's box it lays out.
      const compound = last.replace(/::?[\w-]+(\([^)]*\))?/g, "").replace(/\[[^\]]*\]/g, "").replace(/^[\w-]+|#[\w-]+/g, "");
      const classes = [...compound.matchAll(/\.([\w-]+)/g)].map((m) => m[1]!);
      if (classes.length === 1) box.add(classes[0]!);
      if (classes.length > 1) units.set([...classes].sort().join(" "), [...new Set(classes)].sort());
      for (let i = 0; i < classes.length; i++) {
        for (let j = i + 1; j < classes.length; j++) composed.add([classes[i], classes[j]].sort().join(" "));
      }
    }
  }
  return { box, composed, units: [...units.values()] };
}

/**
 * Every pair of box classes `classList` wears that nothing made deliberate,
 * and every compound box (`.a.b`) worn beside a box class outside it, as all
 * the classes involved.
 */
export function collisionsInList(classList: string, rules: BoxRules): string[] {
  const wearing = new Set(classList.split(/\s+/));
  const worn = [...wearing].filter((name) => rules.box.has(name)).sort();
  const out: string[] = [];
  for (const unit of rules.units.filter((classes) => classes.every((name) => wearing.has(name)))) {
    for (const name of worn) {
      if (unit.includes(name)) continue;
      const all = [...unit, name].sort();
      // A wider compound that names this class too composes it with the unit.
      if (!rules.units.some((other) => all.every((c) => other.includes(c)))) out.push(all.join(" "));
    }
  }
  for (let i = 0; i < worn.length; i++) {
    for (let j = i + 1; j < worn.length; j++) {
      const pair = worn[i] + " " + worn[j];
      if (!DELIBERATE.has(pair) && !rules.composed.has(pair)) out.push(pair);
    }
  }
  return out;
}

/** Every `class` attribute value in rendered HTML, either quote. */
export function classListsIn(html: string): string[] {
  return [...html.matchAll(/\sclass=(?:"([^"]*)"|'([^']*)')/g)].map((m) => m[1] ?? m[2]!);
}

/** The collisions in source literals: double-quoted `class="`, `cls: "` and `className = "`. */
export function collisionsInSource(source: string, rules: BoxRules): string[] {
  const out: string[] = [];
  for (const [, list] of source.matchAll(/(?:class=\\?"|cls: "|className = ")([^"'\\]*)/g)) {
    out.push(...collisionsInList(list!.replace(/<%.*?%>/g, " "), rules));
  }
  return out;
}
