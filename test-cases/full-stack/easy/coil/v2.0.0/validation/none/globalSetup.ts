// Coil — the one static server and the one browser every suite in this project
// shares. CASE-PROVIDED.
//
// WHY THERE IS A GLOBAL SETUP AT ALL. An engineless build is a static site, and
// there is nothing to import: the game is a bundle that runs in a browser, wires
// itself to a canvas and a keyboard, and installs `window.__coil`. So a check
// reaches it the only way anything reaches it — over HTTP, in Chromium. That is
// per-project scaffolding rather than per-suite: launching a browser costs a
// couple of hundred milliseconds and holding one costs a couple of hundred
// megabytes, and doing either a hundred times over is the difference between a
// suite run that takes a minute and one that takes ten.
//
// The whole of it — serving the build output on a loopback port, starting the
// Chromium server, and handing both to the suite workers as addresses through
// vitest's `provide` — is the shared validator harness's, because none of it is
// about Coil. What this file supplies is the two things that are: whose
// validators could not run when something goes wrong, and the handle the run-wide
// "this build installs no surface at all" probe looks for.
//
// IMPORTED FROM ITS OWN MODULE, NOT THE PACKAGE'S BARREL. This file is loaded by
// vite's config path before the test runtime exists, and the barrel would drag
// the harness, the media writer and Playwright's types into the one bundle whose
// failure mode is "the project would not load at all". The handle is stated here
// rather than read off `harness.ts`'s config for the same reason.

import { makeGlobalSetup } from "./case-harness/global-setup";

export default makeGlobalSetup({ slug: "coil", handle: "__coil" });
