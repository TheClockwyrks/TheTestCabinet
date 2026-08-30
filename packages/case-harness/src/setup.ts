// The teardown every suite worker needs, and no suite author should have to
// remember.
//
// `globalSetup` owns the one server and the one Chromium for the whole project;
// each suite file runs in a WORKER of its own and connects to that browser to
// open its pages. This is the matching half: when the file's last test has run,
// the pages and the connection go back.
//
// It is a `setupFiles` entry rather than something the harness does on its own
// because there is no other moment to do it in — a worker has no lifecycle hook
// of its own, and a harness cannot know it was the last one built.
//
// REGISTERING IS A CALL, NOT AN IMPORT. A module that registered an `afterAll`
// merely by being loaded would register one on whatever suite happened to import
// it — and the package's barrel re-exports this, so that would be every suite
// that imports anything at all. So a case's `validation/<engine>/setup.ts` is:
//
// ```ts
// import { registerWorkerTeardown } from "./case-harness/setup";
// registerWorkerTeardown();
// ```

import { afterAll } from "vitest";
import { closeWorkerBrowser } from "./browser";

/** Give this worker the teardown that returns its pages when the file is done. */
export function registerWorkerTeardown(): void {
  afterAll(async () => {
    await closeWorkerBrowser();
  });
}
