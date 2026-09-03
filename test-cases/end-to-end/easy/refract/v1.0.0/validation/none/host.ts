// Refract — what a HOST fault is, and how a check reports one. CASE-PROVIDED.
//
// Every check in this directory exists to answer one question about the build,
// and a check that answers it has to have reached the build first. Reaching it
// takes three things the build has no influence over whatever it does: a browser
// this project started, a page that browser hands over, and a static file this
// project's own loopback server answers with. When one of them does not happen,
// the check learned nothing about the build.
//
// WHY THAT NEEDS ITS OWN OUTCOME. The two answers vitest offers on its own are
// both wrong for it. A thrown error marks the point failed, and `createHarness`
// runs in the `beforeEach` of every check file, so a throw there marks every
// point that file decides failed — on a build that may be perfect. A score is a
// property of the build, so a host that could not start a browser or serve a file
// must never be able to move one.
//
// So a host fault SKIPS the running check instead, naming what did not happen.
// The runner reads a suite whose checks all skipped as inconclusive: the point is
// left undecided for a reviewer rather than scored against the build. A file
// whose other checks did reach the build still decides its point on those, and
// the skipped one is recorded as having decided nothing.
//
// HOW THE RUNNING CHECK IS REACHED FROM HERE. `createHarness` is called from
// `beforeEach` hooks that take no arguments, so rather than thread a context
// through every check file, this module registers a hook of its own from
// `setup.ts` — which vitest runs before every check in the project, ahead of the
// file's own hooks — and remembers the context it is handed. Nothing in a check
// file changes.
//
// WHAT IS NOT A HOST FAULT. A page that loaded and then installed no surface,
// drew nothing, or answered a call wrongly is the build's own doing, and is
// failed as such by the readings that follow. Only the three things above reach
// this module, and no build can provoke any of them.

import { beforeEach } from "vitest";

/** What the running check can be told to do with itself. */
interface RunningCheck {
  skip(note?: string): void;
}

/** The check vitest is running in this worker, or `null` outside one. */
let running: RunningCheck | null = null;

/**
 * Remember the running check, so {@link hostFault} can leave it undecided.
 *
 * Called from `setup.ts` rather than registered on import, so the hook this adds
 * is visibly part of the project's per-suite scaffolding rather than a side
 * effect of importing the harness.
 */
export function trackRunningCheck(): void {
  beforeEach((check: RunningCheck) => {
    running = check;
  });
}

/**
 * Leave the running check undecided: the build was never reached, for `reason`.
 *
 * The reason is written into the skip note and returned to the caller as an
 * error, so it reaches a reviewer through the run's validator output whichever
 * way the check ends.
 */
export function hostFault(reason: string): never {
  const check = running;
  const account = `refract: the build was never reached — ${reason}. This is a fact about the host, not the build.`;
  // Throws a skip signal, so nothing after it in the caller runs.
  if (check !== null) check.skip(account);
  // No check to skip, so naming the reason is the most that can be done with it.
  throw new Error(account);
}
