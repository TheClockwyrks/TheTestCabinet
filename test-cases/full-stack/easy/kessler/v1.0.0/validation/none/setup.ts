// Kessler — per-suite scaffolding for the browser the checks drive. CASE-PROVIDED.
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
// IT IS ALSO WHERE THE RUNNING CHECK IS MADE REACHABLE FROM THE HARNESS, so that
// a browser that never came up, a page that was never opened, or a build this
// project's own server would not hand over leaves a check UNDECIDED rather than
// failing the build for it. The shared harness's `host.ts` says why at length: a
// score is a property of the build, and none of those three things is anything a
// build has any influence over. Without this half, `hostFault` has no check to
// skip and can only throw — and it is called from `openHarness`, which runs in
// the `beforeEach` of every check file, so one unreachable browser would fail
// every point in that file on a build that was never asked anything. The hook has
// to be registered from here because `openHarness` takes no check context of its
// own, and vitest runs a `setupFiles` hook ahead of a file's own.
//
// THE SLUG IS PASSED BECAUSE THE PACKAGE IS SHARED. It does not know at import
// time whose validators it is running, and the account a reviewer reads has to
// name the case — the same slug `globalSetup.ts` hands the server.
//
// The teardown is this project's own rather than the package's, because the
// pages a Kessler harness opens are this project's own: `harness.ts` holds the
// browser context that carries this case's injected probes.

import { afterAll } from "vitest";
import { trackRunningCheck } from "./case-harness/host";
import { closeWorkerBrowser } from "./harness";

trackRunningCheck({ slug: "kessler" });

afterAll(async () => {
  await closeWorkerBrowser();
});
