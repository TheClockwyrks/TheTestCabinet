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
   * The one dial the four cases genuinely disagree on, because what a check costs
   * is the case's: a case whose pointer operations take effect the moment they
   * are called spends a few hundred crossings on its longest scenario, while one
   * whose scenario walks a level to its clear spends thousands of real simulated
   * ticks. Generous against a healthy build either way, and still bounds a hung
   * one.
   */
  readonly testTimeout?: number;
  /** How long a `beforeEach`/`afterEach` may take. */
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

/** A check that takes longer than this has hung rather than run slowly. */
const DEFAULT_TEST_TIMEOUT_MS = 120_000;

/** The ceiling on a suite's own setup and teardown. */
const DEFAULT_HOOK_TIMEOUT_MS = 60_000;

/** How many pages of the one shared browser a project holds open at once. */
const DEFAULT_MAX_WORKERS = 4;

/**
 * The vitest project a case's `validation/<engine>/vitest.config.ts` exports:
 *
 * ```ts
 * import { defineValidationConfig } from "./case-harness/vitest-config";
 * export default defineValidationConfig({
 *   root: new URL("..", import.meta.url).pathname,
 *   testTimeout: 60_000,
 * });
 * ```
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
