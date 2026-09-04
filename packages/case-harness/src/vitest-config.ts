// The vitest project a case's validators run as.
//
// A project of its own, separate from the build's `vitest.config.ts` at the
// workspace root. The two never mix: the build's config names `src/**/*.test.ts`
// and measures coverage over `src/`, so the tests a build wrote are counted and
// covered on their own, and the verdict rests on the checks in the validator
// project alone. A build cannot reach the verdict by writing a test, and a case's
// check cannot flatter the build's coverage.
//
//   npx vitest run                                       # the build's own tests
//   npx vitest run --config validation/vitest.config.ts  # the case's validators
//
// WHY THIS PROJECT NEEDS SCAFFOLDING AN ENGINE-BACKED ONE DOES NOT. An engineless
// build is a static site with nothing to import: the run seeds no `src/` at all,
// so the build wrote its own frame loop, its own canvas fit, its own keyboard,
// its own audio and its own debug surface, and the only place all of that exists
// is a page that has loaded the bundle. So every check drives it in a real
// browser. `globalSetup` starts the one server and the one Chromium the whole
// project shares, before any suite runs; `setupFiles` gives each suite worker the
// teardown that returns its pages when the file is done. The environment stays
// `node` — the suites drive a browser, they do not run in one.

import { defineConfig, type ViteUserConfig } from "vitest/config";

/** The per-case dials, and the one value a case MUST supply. */
export interface ValidationConfigOptions {
  /**
   * The project's root: the WORKSPACE the build was produced in, not the
   * directory this config sits in.
   *
   * A validator addresses the build's output by the same relative path the build
   * itself produced it at, and `globalSetup` probes this root for `dist/`,
   * `build/` or `out/`. A case computes it from its own config's URL —
   * `new URL("..", import.meta.url).pathname` — so the command above works from
   * anywhere. It is a required argument rather than something derived here for
   * the same reason `globalSetup` reads it back off the project: this package is
   * staged one directory deeper than the case's own files, so anything derived
   * from THIS module's location would name the wrong tree.
   */
  readonly root: string;
  /**
   * How long one check may take.
   *
   * A dial the cases may genuinely disagree on, because what a check costs is the
   * case's: a case whose pointer operations take effect the moment they are
   * called spends a few hundred crossings on its longest scenario, while one
   * whose scenario walks a level to its clear spends thousands of real simulated
   * ticks. Generous against a healthy build either way, and still bounds a hung
   * one. A case that leaves it alone gets {@link DEFAULT_TEST_TIMEOUT_MS}, which
   * is set against the worst load these projects have been measured under rather
   * than against a quiet box; raise it only for a case that is genuinely costlier
   * than that, and do not lower it to make a fast case look fast.
   */
  readonly testTimeout?: number;
  /**
   * How long a `beforeEach`/`afterEach` may take.
   *
   * Wider than every ceiling the harness itself sets, for the reason
   * {@link DEFAULT_HOOK_TIMEOUT_MS} gives: whichever allowance runs out first is
   * the one that writes the account a reviewer reads, and "a hook expired" says
   * far less than "the surface never appeared" or "the browser was unreachable".
   */
  readonly hookTimeout?: number;
  /**
   * How many suite files may be in flight at once.
   *
   * Each holds a page of the shared browser while it runs, so the ceiling on
   * files is the ceiling on pages — and a suite spends almost all of its time
   * waiting on a crossing into one, so overlapping them is most of what decides
   * how long the whole run takes. Capped rather than left to the core count
   * because the cost of a page is memory in one shared browser process rather
   * than a core, and the host running this is running a model's build under it.
   */
  readonly maxWorkers?: number;
}

/**
 * How long one check may take, for a case that names no ceiling of its own.
 *
 * WHAT A TIMEOUT IS FOR, AND WHAT IT MUST NOT DO. Nothing these projects measure
 * is taken from the wall clock: every check drives the build frame by frame and
 * asserts on what the build's own snapshot reports. The one wall clock left is
 * this allowance — and an allowance a correct build can cross is a defect in the
 * check, because it turns "how busy the machine was" into a lost point on a build
 * that did nothing wrong.
 *
 * Sixty seconds was such an allowance. On a host running nine of these projects
 * at once (load average ~450), an unmodified reference lost four points to it —
 * `cascade/tier-ladder`, `cascade/sequence-is-endless`,
 * `cascade/boards-meet-the-tier-floor` and `campaign/select-states` — at 66-76 s
 * apiece against quiet times of 6-14 s. Nothing about those checks is unusual;
 * any case's longest scenario is one busy host away from the same fate.
 *
 * Five minutes is set against that measured worst case rather than against a
 * healthy machine, and against the one ceiling a validator project cannot move:
 * the runner caps the WHOLE suite run at forty-five minutes (`VITEST_TIMEOUT`,
 * `crates/core/src/vitest_validator.rs`). At load average ~650 — half again the
 * worst these projects have been run under — the slowest file measured 170 s and
 * the whole run 1 059 s of those 2 700. Five minutes is a NINTH of the outer cap,
 * so a single file can only cross it on a host where the whole run was already
 * lost; below that, no correct build loses a point to the clock. A hung build is
 * still bounded, twice over.
 */
const DEFAULT_TEST_TIMEOUT_MS = 300_000;

/**
 * The ceiling on a suite's own setup and teardown.
 *
 * A hook reaches the shared browser, takes a page off it, loads the built site in
 * that page, and waits for the surface and the recorder. The reasoning above
 * applies, and one thing more: this allowance has to be wider than every ceiling
 * the harness itself sets, or the last of them is decided here instead. A hook
 * that runs out reports that a hook ran out; the harness's own ceilings report
 * which wait was crossed and whether it was the host or the build that crossed it
 * — `connectChromium` names an unreachable browser, `loadBuild` names a build the
 * server would not hand over, and `readSurfaceFault` names a build that installed
 * no surface — which is the account a reviewer needs. Those ceilings sum to well
 * under half of this, whatever a case raises its surface probe to, so a hook that
 * reaches five minutes has met something none of them describe.
 */
const DEFAULT_HOOK_TIMEOUT_MS = 300_000;

/**
 * How many pages of the one shared browser a project holds open at once.
 *
 * Eight rather than four, because the number that matters is not how long a
 * project takes on an idle box — it is how much of the runner's cap on the WHOLE
 * suite run is left on a busy one. A crossing into a browser costs 6 ms on an idle
 * host and 90 ms on a loaded one, and a worker waiting on one holds no core; four
 * workers left a project serialized behind that wait while the box had cores to
 * spare, and the whole run measured 700 s of the runner's 2 700 s cap. Eight
 * halves that, and a page is still memory rather than a core.
 *
 * And eight rather than sixteen, which was measured too. At load average ~650 the
 * same suite run took 1 059 s at eight workers with its slowest FILE at 170 s, and
 * 861 s at sixteen with its slowest file at 316 s — sixteen buys 19% off the wall
 * clock by making every file compete with fifteen siblings, and four points
 * crossed the per-test allowance and were lost. The whole-run cap is the runner's
 * to spend; the per-test one is what decides a build's score, so the worker count
 * is set to protect the second.
 */
const DEFAULT_MAX_WORKERS = 8;

/**
 * The vitest project a case's `validation/<engine>/vitest.config.ts` exports:
 *
 * ```ts
 * import { defineValidationConfig } from "./case-harness/vitest-config";
 * export default defineValidationConfig({
 *   root: new URL("..", import.meta.url).pathname,
 * });
 * ```
 *
 * The dials are for a case that is genuinely unlike the others; the defaults
 * below are the measured ones and a case that says nothing gets them.
 *
 * Everything but the dials is fixed, because everything but the dials is what
 * makes a staged validator project one shape the runner can drive: the project's
 * name, the suites it collects, the scaffolding it loads, and the refusal to pass
 * a run that collected nothing.
 */
export function defineValidationConfig(
  options: ValidationConfigOptions,
): ViteUserConfig {
  return defineConfig({
    root: options.root,
    test: {
      name: "validation",
      include: ["validation/**/*.test.ts"],
      environment: "node",
      globalSetup: ["validation/globalSetup.ts"],
      setupFiles: ["validation/setup.ts"],
      // A missing validator is a broken suite, not a passing one.
      passWithNoTests: false,
      coverage: { enabled: false },
      maxWorkers: options.maxWorkers ?? DEFAULT_MAX_WORKERS,
      minWorkers: 1,
      testTimeout: options.testTimeout ?? DEFAULT_TEST_TIMEOUT_MS,
      hookTimeout: options.hookTimeout ?? DEFAULT_HOOK_TIMEOUT_MS,
    },
  });
}
