// Turbo Drive: links and forms navigate by fetch and swap <body>, keeping the
// head (stylesheet, this script) loaded.
//
// A page whose own module script runs once at load (sockets, timers, listeners
// on document) opts out with a turbo-visit-control "reload" meta, both ways:
// Turbo reloads when it arrives at one, because a module URL already in the
// document's module map is never executed again, and the listener below
// reloads when leaving one (Back and Forward included), or its socket and timers outlive its body.
import "@hotwired/turbo";

const reloadOnly = () =>
  document.head.querySelector('meta[name="turbo-visit-control"][content="reload"]') !== null;

document.addEventListener("turbo:before-visit", (event) => {
  if (!reloadOnly()) return;
  event.preventDefault();
  window.location.assign(event.detail.url);
});

document.addEventListener("turbo:visit", (event) => {
  if (event.detail.action === "restore" && reloadOnly()) window.location.reload();
});
