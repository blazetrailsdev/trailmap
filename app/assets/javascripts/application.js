// Turbo Drive: links and forms navigate by fetch and swap <body>, keeping the
// head (stylesheet, this script) loaded.
//
// A page whose own module script runs once at load (sockets, timers, listeners
// on document) opts out with a turbo-visit-control "reload" meta, both ways.
// Turbo reloads when it arrives at one, because a module URL already in the
// document's module map is never executed again. Leaving one must be a full
// load too, or its socket and timers outlive its body: data-turbo="false" on
// <body> hands every link and form on it back to the browser (a Drive form
// would POST by fetch first), and Back and Forward, which that does not cover,
// reload below.
import "@hotwired/turbo";

const reloadOnly = () =>
  document.head.querySelector('meta[name="turbo-visit-control"][content="reload"]') !== null;

if (reloadOnly()) document.body.dataset.turbo = "false";

document.addEventListener("turbo:visit", (event) => {
  if (event.detail.action === "restore" && reloadOnly()) window.location.reload();
});
