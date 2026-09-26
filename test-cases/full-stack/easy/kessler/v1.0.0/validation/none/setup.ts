// Kessler — per-suite scaffolding for the browser the checks drive. CASE-PROVIDED.
//
// `globalSetup.ts` owns the one server and the one Chromium; each suite file runs
// in a worker of its own and connects to that browser to open a page. This gives
// every suite the matching teardown without asking a suite author to remember it:
// when the file's last test has run, the pages and the connection go back.
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
// skip and can only throw — and it is reached from `openHarness`, which runs in
// the `beforeEach` of every check file, so one unreachable browser would fail
// every point in that file on a build that was never asked anything.
//
// ONE CALL RATHER THAN TWO, because forgetting the second is silent: the suites
// pass, and the first unreachable browser fails a point on a build that was never
// asked anything.
//
// THE SLUG IS PASSED BECAUSE THE PACKAGE IS SHARED. It does not know at import
// time whose validators it is running, and the account a reviewer reads has to
// name the case — the same slug `globalSetup.ts` hands the server.

import { registerCaseSetup } from "./case-harness/setup";

registerCaseSetup({ slug: "kessler" });
