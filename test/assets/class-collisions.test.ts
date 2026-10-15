import { describe, expect, it } from "vitest";
import { Dir, getFs } from "@blazetrails/ruby-compat";
import { STYLESHEET, boxRules, classListsIn, collisionsInList, collisionsInSource } from "../../scripts/class-collisions.js";

/**
 * A CSS class collision is invisible to every other check: the markup is
 * right, the strings a unit test asserts are right, and the page is wrong.
 * `scripts/class-collisions.ts` has the rule; this file applies it to the
 * SOURCE literals, which reach the class lists no page render produces —
 * a row the stream draws only for a state the fixtures do not hold.
 *
 * The rendered pages are checked in `test/views/rendered-class-collisions.test.ts`
 * and the dashboard's run-time DOM by `scripts/dashboard-e2e.ts`. Between the
 * three, what is still invisible: a class list only JavaScript builds, for a
 * state neither the e2e stand-in nor any source literal shows whole.
 */
const SOURCES = ["app/views/**/*.tse", "app/assets/javascripts/*.js"];

describe("the CSS class space", () => {
  it("has no element wearing two classes that each lay out their own box", async () => {
    const rules = boxRules(await getFs().readFile(STYLESHEET, "utf8"));
    const files = SOURCES.flatMap((pattern) => Dir.glob(pattern));
    expect(files.length).toBeGreaterThan(20);

    const found: string[] = [];
    for (const file of files) {
      for (const pair of collisionsInSource(await getFs().readFile(file, "utf8"), rules)) {
        found.push(`${file}: class="${pair}"`);
      }
    }
    expect(found).toEqual([]);
  });

  it("goes red on the collision that shipped in trailmap#47", async () => {
    const rules = boxRules(await getFs().readFile(STYLESHEET, "utf8"));

    expect(collisionsInSource(`'<div class="pcell empty"><span class="plabel">'`, rules)).toEqual(["empty pcell"]);
    expect(collisionsInSource(`<div class="pcell unassigned">`, rules)).toEqual([]);
  });

  it("reads descendant and compound rules", () => {
    const rules = boxRules(".card { padding: 4px } .wrap .btn { display: flex } .a.b { padding: 0 } .a { position: relative } .b { display: block }");

    expect([...rules.box].sort()).toEqual(["a", "b", "btn", "card"]);
    expect(collisionsInList("card btn", rules)).toEqual(["btn card"]);
    // `.a.b` is the stylesheet composing the pair: one component.
    expect(collisionsInList("a b", rules)).toEqual([]);
  });

  it("counts a type-qualified class as a box class", () => {
    const rules = boxRules("button.a { display: grid } .b { padding: 0 } a[href].c:hover { position: relative }");

    expect([...rules.box].sort()).toEqual(["a", "b", "c"]);
    expect(collisionsInList("a b", rules)).toEqual(["a b"]);
  });

  it("counts a compound box against a box class outside it", () => {
    const rules = boxRules(".a.b { display: grid } .c { padding: 0 } .a.b.c { display: block }");

    expect(collisionsInList("a b c", boxRules(".a.b { display: grid } .c { padding: 0 }"))).toEqual(["a b c"]);
    // `.a.b.c` composes all three: one component.
    expect(collisionsInList("a b c", rules)).toEqual([]);
    expect(collisionsInList("a b", rules)).toEqual([]);
  });

  it("counts two compound boxes against each other", () => {
    const rules = boxRules(".a.b { display: grid } .c.d { padding: 0 }");

    expect(collisionsInList("a b c d", rules)).toEqual(["a b c d"]);
  });

  it("exempts a pair only through a compound the element matches", () => {
    const rules = boxRules(".a { display: block } .b { padding: 0 } .a.b.c { position: relative }");

    expect(collisionsInList("a b", rules)).toEqual(["a b"]);
    expect(collisionsInList("a b c", rules)).toEqual([]);
  });

  it("reads every class attribute of rendered HTML, either quote", () => {
    expect(classListsIn(`<div class="a b"><span class='c'></span><p data-class="x"></p></div>`)).toEqual(["a b", "c"]);
  });
});
