// Arc Foundry — the one static server and the one browser every suite in this
// project shares. CASE-PROVIDED, over the shared harness.
//
// WHY THERE IS A GLOBAL SETUP AT ALL. An engineless build is a static site, and
// there is nothing to import: the game is a bundle that runs in a browser, wires
// itself to a canvas, a keyboard and a pointer, and installs `window.__foundry`.
// So a check reaches it the only way anything reaches it — over HTTP, in
// Chromium. That is per-project scaffolding rather than per-suite: launching a
// browser costs a couple of hundred milliseconds and holding one costs a couple
// of hundred megabytes, and doing either once per suite across the hundreds of
// points this case declares is the difference between a suite run that takes
// minutes and one that takes an hour.
//
// The whole of it — finding the build output, serving it on a loopback port,
// starting the Chromium server, and handing both to the suite workers as
// addresses through vitest's `provide` — is the shared validator harness's,
// because none of it is about Arc Foundry. The produced files a full-stack build
// commits beside its bundle are served with their real content types there too,
// so a build that plays a `.wav` cue through an `<audio>` element rather than
// through a decoded buffer is read the way it plays.
//
// WHAT THIS FILE SUPPLIES is the two things that are genuinely the case's: whose
// validators could not run when something goes wrong, and the handle to probe
// for. The handle buys TIME rather than a verdict — a build that installs no
// surface at all is settled once here, on pages of this setup's own, instead of
// costing every one of the project's three hundred harnesses the full ceiling —
// so the figure it probes under is the same one `harness.ts` gives the surface.
//
// IMPORTED FROM ITS OWN MODULE, NOT THE PACKAGE'S BARREL. This file is loaded by
// vite's config path before the test runtime exists, and the barrel would drag
// the harness, the media writer and Playwright's types into the one bundle whose
// failure mode is "the project would not load at all".

import { makeGlobalSetup } from "./case-harness/global-setup";

export default makeGlobalSetup({
  slug: "arc-foundry",
  handle: "__foundry",
  surfaceTimeoutMs: 15_000,
});
