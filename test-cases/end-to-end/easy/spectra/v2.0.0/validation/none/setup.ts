// Spectra — per-suite scaffolding for the browser the checks drive. CASE-PROVIDED.
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
// a browser that never came up, a page that was never opened, or a build the
// project's own server would not hand over leaves a check UNDECIDED rather than
// failing the build for it. The shared harness's `host.ts` says why at length: a
// score is a property of the build, and none of those three things is anything a
// build has any influence over. The hook has to be registered from here because
// `createHarness` is called from `beforeEach` hooks that take no arguments, and
// vitest runs a `setupFiles` hook ahead of a file's own. This project carried
// only the teardown half before; the account a reviewer reads was the half that
// was missing.
//
// THE SLUG IS PASSED BECAUSE THE PACKAGE IS SHARED. Unlike the per-case copy this
// grew out of, the harness does not know at import time whose validators it is
// running, and the account a reviewer reads has to name the case. This call is
// the one moment the case is certainly present.
//
// Both halves are REGISTERED by a call rather than by importing this module's
// contents, because the shared harness's barrel re-exports them: a module that
// registered an `afterAll` or a `beforeEach` merely by being loaded would register
// one on every suite that imports anything at all.

import { registerCaseSetup } from "./case-harness/setup";

registerCaseSetup({ slug: "spectra" });
