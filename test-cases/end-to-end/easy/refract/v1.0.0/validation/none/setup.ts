// Refract — per-suite scaffolding for the browser the checks drive. CASE-PROVIDED.
//
// `globalSetup.ts` owns the one server and the one Chromium; each suite file runs
// in a worker of its own and connects to that browser to open a page. This gives
// every suite the matching teardown without asking a suite author to remember it:
// when the file's last test has run, the page and the connection go back.
//
// It is a `setupFiles` entry rather than something the harness does on its own
// because there is no other moment to do it in — a worker has no lifecycle hook
// of its own, and a harness cannot know it built the last one.
//
// It is also where the running check is made reachable from the harness, so that
// a browser that never came up or a page that was never served leaves a check
// undecided rather than failing the build for it. `host.ts` says why.

import { afterAll } from "vitest";
import { closeWorkerBrowser } from "./harness";
import { trackRunningCheck } from "./host";

trackRunningCheck();

afterAll(async () => {
  await closeWorkerBrowser();
});
