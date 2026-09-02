// Gantry — per-suite scaffolding for the browser the checks drive. CASE-PROVIDED.
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
// The teardown is REGISTERED by a call rather than by importing this module's
// contents, because the shared harness's barrel re-exports it: a module that
// registered an `afterAll` merely by being loaded would register one on every
// suite that imports anything at all.

import { registerWorkerTeardown } from "./case-harness/setup";

registerWorkerTeardown();
