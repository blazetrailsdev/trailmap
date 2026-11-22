import { morphChildren } from "@hotwired/turbo";

/**
 * Bring `host`'s children to `html` with Turbo's morph (idiomorph), so a node
 * that is the same in both -- above all the field someone is typing in -- is
 * never removed from the page. Replacing it would blur it, and on a phone a
 * focus put back from script does not reopen the keyboard.
 *
 * idiomorph also copies each input's live `value` and `checked` from the new
 * markup, which would wipe what a person has typed or picked in any field but
 * the focused one; Turbo lets that be vetoed per attribute, and this does, for
 * a text box's value and a choice's check. A choice's `value` is its identity
 * and is synced as usual.
 */
export function morph(host, html) {
  if (!vetoed.has(host)) {
    host.addEventListener("turbo:before-morph-attribute", keepTyped);
    vetoed.add(host);
  }
  const next = host.ownerDocument.createElement("div");
  next.innerHTML = html;
  morphChildren(host, next);
}

const vetoed = new WeakSet();

const CHOICE = new Set(["radio", "checkbox"]);

function keepTyped(event) {
  const el = event.target;
  const name = event.detail.attributeName;
  const choice = el instanceof HTMLInputElement && CHOICE.has(el.type);
  const typed = el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && !choice);
  if ((name === "checked" && choice) || (name === "value" && typed)) event.preventDefault();
}
