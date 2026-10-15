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
 * A compound rule (`.pcell.unassigned`) is a box of its own on an element
 * wearing all its classes, and it makes those classes one component THERE.
 * A descendant or child rule (`.card .btn`) lays out its LAST class's box in that context, so that class
 * counts as a box class. A compound box worn beside another box class is a
 * collision too: `.a.b` and `.c` on one element are two boxes. A type, id, attribute or pseudo-class in the compound
 * (`button.a`, `.a:hover`) still makes its one class a box class.
 */
export const STYLESHEET = "app/assets/stylesheets/application.css";

/** Pairs that are one component and its modifier, each naming why. */
export const DELIBERATE = new Set([
  "btn btn-sm", // `.btn-sm` is `.btn` with less padding.
]);

/** What the stylesheet says about boxes: the classes that lay one out, and the compounds that do. */
export interface BoxRules {
  box: Set<string>;
  /** Each compound rule's classes, sorted: a box of its own on an element wearing them all. */
  units: string[][];
}

export function boxRules(css: string): BoxRules {
  const box = new Set<string>();
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
      const classes = [...new Set([...compound.matchAll(/\.([\w-]+)/g)].map((m) => m[1]!))].sort();
      if (classes.length === 1) box.add(classes[0]!);
      if (classes.length > 1) units.set(classes.join(" "), classes);
    }
  }
  return { box, units: [...units.values()] };
}

/**
 * Every two boxes `classList` puts on one element, as all the classes the two
 * involve. A box is a box class it wears, or a compound rule (`.a.b`) whose
 * classes it wears ALL of. Two boxes are one component only when a compound
 * the element matches names every class of both, or the pair is DELIBERATE.
 */
export function collisionsInList(classList: string, rules: BoxRules): string[] {
  const wearing = new Set(classList.split(/\s+/).filter(Boolean));
  const matched = rules.units.filter((classes) => classes.every((name) => wearing.has(name)));
  const boxes = [...[...wearing].filter((name) => rules.box.has(name)).sort().map((name) => [name]), ...matched];
  const out = new Set<string>();
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const all = [...new Set([...boxes[i]!, ...boxes[j]!])].sort();
      if (DELIBERATE.has(all.join(" "))) continue;
      if (matched.some((unit) => all.every((name) => unit.includes(name)))) continue;
      out.add(all.join(" "));
    }
  }
  return [...out];
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
