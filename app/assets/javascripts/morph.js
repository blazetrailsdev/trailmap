/**
 * Bring `host`'s children to `html` by changing only what differs, so a node
 * that is the same in both -- above all the field someone is typing in -- is
 * never removed from the page. Replacing it would blur it, and on a phone a
 * focus put back from script does not reopen the keyboard.
 *
 * Children are paired by `id` where they have one and by position among the
 * ones that do not; a pair whose tag differs is replaced. Attributes are
 * synced; what a person has typed or picked lives in properties, which are
 * left alone, and a textarea's contents are never rewritten.
 */
export function morph(host, html) {
  const next = host.ownerDocument.createElement("template");
  next.innerHTML = html;
  morphChildren(host, next.content);
}

function morphChildren(parent, nextParent) {
  const old = [...parent.childNodes];
  const byId = new Map(
    old.filter((n) => n.nodeType === 1 && n.id).map((n) => [n.id, n]),
  );
  const plain = old.filter((n) => !(n.nodeType === 1 && n.id));
  let cursor = 0;
  const wanted = [...nextParent.childNodes].map((n) => {
    const id = n.nodeType === 1 ? n.id : "";
    const match = id ? byId.get(id) : plain[cursor++];
    if (id) byId.delete(id);
    return match ? morphNode(match, n) : n;
  });
  const keep = new Set(wanted);
  for (const n of old) if (!keep.has(n)) n.remove();
  wanted.forEach((n, i) => {
    if (parent.childNodes[i] !== n)
      parent.insertBefore(n, parent.childNodes[i] || null);
  });
}

/** The node to keep in `next`'s place: `old`, brought up to date, or `next` itself. */
function morphNode(old, next) {
  if (old.nodeType !== next.nodeType || old.nodeName !== next.nodeName)
    return next;
  if (old.nodeType !== 1) {
    if (old.nodeValue !== next.nodeValue) old.nodeValue = next.nodeValue;
    return old;
  }
  for (const { name } of [...old.attributes])
    if (!next.hasAttribute(name)) old.removeAttribute(name);
  for (const { name, value } of [...next.attributes])
    if (old.getAttribute(name) !== value) old.setAttribute(name, value);
  if (old.nodeName !== "TEXTAREA") morphChildren(old, next);
  return old;
}
