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
// It is also where the running check is made reachable from the harness, so that
// a browser that never came up or a page that was never served leaves a check
// undecided rather than failing the build for it. `host.ts` says why, and why the
// case's slug has to arrive here: this package is shared, so the account a
// reviewer reads can only name the case if the case names itself.
//
// REGISTERING IS A CALL, NOT AN IMPORT. A module that registered an `afterAll`
// merely by being loaded would register one on whatever suite happened to import
// it — and the package's barrel re-exports this, so that would be every suite
// that imports anything at all. So a case's `validation/<engine>/setup.ts` is:
//
// ```ts
// import { registerCaseSetup } from "./case-harness/setup";
// registerCaseSetup({ slug: "carom" });
// ```

import { afterAll } from "vitest";
import { closeWorkerBrowser } from "./browser";
import { trackRunningCheck, type HostFaultOptions } from "./host";

/** What a case tells its per-suite scaffolding about itself. */
export type CaseSetupOptions = HostFaultOptions;

/** Give this worker the teardown that returns its pages when the file is done. */
export function registerWorkerTeardown(): void {
  afterAll(async () => {
    await closeWorkerBrowser();
  });
}

/**
 * Everything a suite worker needs before its first check runs: the teardown that
 * returns its pages, and the hook that keeps the running check reachable so a
 * host fault can leave it undecided.
 *
 * One call rather than two, because forgetting the second is silent — the suites
 * pass, and the first unreachable browser fails a point on a build that was never
 * asked anything. {@link registerWorkerTeardown} stays exported for a case that
 * has some reason to take only that half.
 */
export function registerCaseSetup(options: CaseSetupOptions): void {
  trackRunningCheck(options);
  registerWorkerTeardown();
}
