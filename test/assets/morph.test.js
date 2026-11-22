// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { morph } from "../../app/assets/javascripts/morph.js";

const host = (html) => {
  const el = document.createElement("div");
  el.innerHTML = html;
  document.body.replaceChildren(el);
  return el;
};

describe("morph", () => {
  it("keeps a field being typed in, focused and with its text, while the rest changes", () => {
    const list = host(
      '<p id="a">one</p><article id="b"><span>1m ago</span><textarea data-keep="k"></textarea></article>',
    );
    const box = list.querySelector("textarea");
    box.focus();
    box.value = "half typed";

    morph(
      list,
      '<p id="a">two</p><article id="b"><span>2m ago</span><textarea data-keep="k"></textarea></article>',
    );

    expect(list.querySelector("textarea")).toBe(box);
    expect(document.activeElement).toBe(box);
    expect(box.value).toBe("half typed");
    expect(list.textContent).toBe("two2m ago");
  });

  it("pairs rows by id, so a row inserted above keeps the ones below in place", () => {
    const list = host('<article id="b"><input data-keep="x"></article>');
    const input = list.querySelector("input");
    input.value = "kept";

    morph(
      list,
      '<article id="a">new</article><article id="b"><input data-keep="x"></article>',
    );

    expect([...list.children].map((c) => c.id)).toEqual(["a", "b"]);
    expect(list.querySelector("input")).toBe(input);
    expect(input.value).toBe("kept");
  });

  it("drops rows that are gone, replaces a node whose tag changed, and syncs attributes", () => {
    const list = host(
      '<div id="gone"></div><button class="btn" disabled>sending</button><span>x</span>',
    );

    morph(list, '<button class="btn btn-primary">Send</button><em>x</em>');

    expect(list.innerHTML).toBe(
      '<button class="btn btn-primary">Send</button><em>x</em>',
    );
  });

  it("keeps what was typed in a box that is not focused, and a choice's value stays its identity", () => {
    const list = host('<p id="q"><input type="text" data-keep="a"><input type="text" data-keep="b"><input type="radio" value="x"></p>');
    const [a, b] = list.querySelectorAll("input[type=text]");
    a.value = "typed first";
    b.focus();

    morph(list, '<p id="q"><input type="text" data-keep="a"><input type="text" data-keep="b"><input type="radio" value="y"></p>');

    expect(list.querySelector("input[type=text]")).toBe(a);
    expect(a.value).toBe("typed first");
    expect(list.querySelector("input[type=radio]").value).toBe("y");
  });

  it("keeps a picked choice", () => {
    const list = host(
      '<fieldset id="q"><input type="radio" name="n" value="a"><input type="radio" name="n" value="b"></fieldset>',
    );
    const b = list.querySelectorAll("input")[1];
    b.checked = true;

    morph(
      list,
      '<fieldset id="q"><input type="radio" name="n" value="a"><input type="radio" name="n" value="b"></fieldset>',
    );

    expect(list.querySelectorAll("input")[1]).toBe(b);
    expect(b.checked).toBe(true);
  });
});
