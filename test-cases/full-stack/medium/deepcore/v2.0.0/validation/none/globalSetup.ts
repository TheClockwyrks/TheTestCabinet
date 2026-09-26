// Deepcore — the one static server and the one browser every suite in this
// project shares. CASE-PROVIDED.
//
// WHY THERE IS A GLOBAL SETUP AT ALL. An engineless build is a static site, and
// there is nothing to import: the game is a bundle that runs in a browser, wires
// itself to a canvas and a keyboard, and installs `window.__deepcore`. So a check
// reaches it the only way anything reaches it — over HTTP, in Chromium. That is
// per-project scaffolding rather than per-suite: launching a browser costs a
// couple of hundred milliseconds and holding one costs a couple of hundred
// megabytes, and doing either three hundred times over is the difference between
// a suite run that takes a minute and one that takes ten.
//
// The whole of it — finding the build output, serving it on a loopback port,
// starting the Chromium server, and handing both to the suite workers as
// addresses through vitest's `provide` — is the shared validator harness's,
// because none of it is about Deepcore. The produced files a full-stack build
// commits beside its bundle are served with their real content types there too,
// so the `.wav` cues this case has the build produce are read the way they play.
// What this file supplies is what is genuinely the case's: whose validators could
// not run when something goes wrong, and the handle the run-wide surface probe
// looks for.
//
// THE HANDLE IS PASSED, AND WHAT IT BUYS IS TIME RATHER THAN A VERDICT. With it,
// the run answers "does this build install a surface at all" once, on pages of
// its own and for the whole of the ceiling, instead of every one of this
// project's several hundred harnesses paying that ceiling again. The ceiling
// passed with it is the one `harness.ts` gives the worker-side probe, because a
// probe that waited LESS than a harness does could call a slow build surfaceless
// and have every harness agree without checking.
//
// IMPORTED FROM ITS OWN MODULE, NOT THE PACKAGE'S BARREL. This file is loaded by
// vite's config path before the test runtime exists, and the barrel would drag
// the harness, the media writer and Playwright's types into the one bundle whose
// failure mode is "the project would not load at all". That is also why the
// handle and the ceiling are written out here rather than read off `harness.ts`.

import { makeGlobalSetup } from "./case-harness/global-setup";

export default makeGlobalSetup({
  slug: "deepcore",
  handle: "__deepcore",
  surfaceTimeoutMs: 15_000,
});
