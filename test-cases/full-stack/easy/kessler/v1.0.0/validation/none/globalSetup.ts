// Kessler — the one static server and the one browser every suite in this
// project shares. CASE-PROVIDED, over the shared harness.
//
// WHY THERE IS A GLOBAL SETUP AT ALL. An engineless build is a static site, and
// there is nothing to import: the game is a bundle that runs in a browser, wires
// itself to a canvas and a keyboard, and installs `window.__kessler`. So a check
// reaches it the only way anything reaches it — over HTTP, in Chromium. That is
// per-project scaffolding rather than per-suite: launching a browser costs a
// couple of hundred milliseconds and holding one costs a couple of hundred
// megabytes, and doing either three hundred times over is the difference between
// a suite run that takes a minute and one that takes ten.
//
// NONE OF THAT IS KESSLER'S. Serving `dist/`, launching Chromium, handing both
// over to the workers as addresses, and settling once — cheaply, here — whether
// the build installs a debug surface at all: every engineless case needs exactly
// that, and it lives in `@clockwyrks/case-harness`. What this file says is who is
// being validated and which global the surface probe looks for.
//
// THE HANDLE IS WHAT MAKES THE RUN-WIDE PROBE WORTH ANYTHING. Every harness has
// to know whether a surface is there, and the ceiling it waits under is
// deliberately generous — so a surfaceless build would have three hundred
// harnesses each waiting it out. Naming the handle here buys that answer once.
//
// It is imported by its own specifier rather than through the package's barrel:
// this file is loaded by vite's own config path, before the test runtime exists,
// and reaching it through the barrel would drag the whole package into it.

import { makeGlobalSetup } from "./case-harness/global-setup";
import { HANDLE, SURFACE_TIMEOUT_MS } from "./surface";

export default makeGlobalSetup({
  slug: "kessler",
  handle: HANDLE,
  surfaceTimeoutMs: SURFACE_TIMEOUT_MS,
});
