// Shatter — per-suite scaffolding for the browser the checks drive. CASE-PROVIDED.
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
// undecided rather than failing the build for it. The shared harness's `host.ts`
// says why: reaching the build takes a browser, a page and a served file, none of
// which the build has any influence over, so a check that met one of those faults
// learned nothing about the build and must not be able to move its score. The
// case's SLUG arrives with the registration because the harness is shared — the
// account a reviewer reads can only name Shatter if Shatter names itself.
//
// REGISTERING IS A CALL, NOT AN IMPORT, for both halves, because the shared
// harness's barrel re-exports them: a module that registered an `afterAll` or a
// `beforeEach` merely by being loaded would register one on every suite that
// imports anything at all.
//
// One call rather than two, because forgetting the second is silent — the suites
// pass, and the first unreachable browser fails a point on a build that was never
// asked anything.

import { registerCaseSetup } from "./case-harness/setup";

registerCaseSetup({ slug: "shatter" });
