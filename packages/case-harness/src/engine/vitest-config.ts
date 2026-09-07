// The vitest project a case's ENGINE validators run as.
//
// A project of its own, separate from the build's `vitest.config.ts` at the
// workspace root, for the same reason the engineless one is: the build's config
// names `src/**/*.test.ts` and measures coverage over `src/`, so a build cannot
// reach the verdict by writing a test and a case's check cannot flatter the
// build's coverage.
//
//   npx vitest run                                       # the build's own tests
//   npx vitest run --config validation/vitest.config.ts  # the case's validators
//
// WHAT AN ENGINE PROJECT DOES NOT NEED. `../vitest-config` names a `globalSetup`
// that stands up a server and a browser, and a `setupFiles` that returns each
// worker's pages. An engine project has neither: the engine is constructed in
// process, over a canvas the harness owns, and a check steps it with
// `engine.advance`. Nothing is served, nothing is launched, and there is nothing
// to give back — so this config names no scaffolding at all, and a case's engine
// directory carries no `globalSetup.ts` and no `setup.ts`.
//
// THE ENVIRONMENT IS STILL `node`, on all four engines. Every engine takes its
// measurements through the `SurfaceMetrics` the harness supplies, so none of them
// needs a DOM — including the two 3D ones, which stand their renderer up over a
// WebGL2 stub the case supplies rather than over a real one. There is no
// browser-mode project anywhere in the tree, and a case that reached for one
// would be reaching for a toolchain the seeded workspace does not carry.
//
// WHY THIS IS NOT REACHED THROUGH THE BARREL. Same reason `../vitest-config` is
// not: it is loaded by vite's own config path, before the test runtime exists,
// and it is the file whose failure mode is "the project would not load at all".
// Reaching it through `./index` would drag the harness, `@napi-rs/canvas` and the
// whole vite graph into every worker that imports anything, for one function no
// suite ever calls. A case's `vitest.config.ts` imports this specifier DIRECTLY.

import { defineConfig, type ViteUserConfig } from "vitest/config";

/** The per-case dials, and the one value a case MUST supply. */
export interface EngineValidationConfigOptions {
  /**
   * The project's root: the WORKSPACE the build was produced in, not the
   * directory this config sits in.
   *
   * A validator imports the build's own modules by the same relative paths the
   * build uses (`../src/game`), so the root has to be the workspace. A case
   * computes it from its own config's URL — `new URL("..", import.meta.url)` —
   * so the command above works from anywhere, and it is a required argument
   * rather than something derived here because this package is staged one
   * directory deeper than the case's files and anything derived from THIS
   * module's location would name the wrong tree.
   */
  readonly root: string;
  /**
   * How long one check may take.
   *
   * A dial the cases genuinely disagree on, and the measured spread across the
   * tree is 60 s to 600 s. What a check costs is the case's: a case whose pointer
   * operations resolve at the call spends a few hundred cheap steps on its
   * longest scenario, while one that walks a twenty-five-board sweep spends
   * hundreds of thousands of real simulated ticks. A case that leaves it alone
   * gets {@link DEFAULT_TEST_TIMEOUT_MS}.
   */
  readonly testTimeout?: number;
  /**
   * How long a `beforeEach`/`afterEach` may take.
   *
   * Vitest defaults an unset hook allowance to TEN SECONDS, which is the tightest
   * wall clock a validator project has and the one least related to anything the
   * build does — a `beforeEach` that constructs an engine and awaits the game's
   * `initialize` can cross it on a loaded host alone. Four of the projects in the
   * tree leave it unset and are one busy host away from losing every point in a
   * file to it, so it is set explicitly here for every case that says nothing.
   */
  readonly hookTimeout?: number;
  /**
   * How many suite files may be in flight at once.
   *
   * Left to vitest's own default unless a case names one. An engine project's
   * worker is CPU-bound — it is running the build's simulation — where an
   * engineless project's is waiting on a browser, so the two want opposite
   * settings and this one wants the pool's own reading of the machine.
   *
   * A count, or vitest's own percentage-of-cores form (`"50%"`), for a case whose
   * ceiling is a share of the host rather than a figure.
   */
  readonly maxWorkers?: number | string;
}

/**
 * How long one check may take, for a case that names no ceiling of its own.
 *
 * WHAT A TIMEOUT IS FOR, AND WHAT IT MUST NOT DO. Nothing these projects measure
 * is taken from the wall clock: every check drives the game frame by frame
 * through the engine and asserts on what the build's own snapshot reports. The
 * one wall clock left is this allowance — and an allowance a correct build can
 * cross is a defect in the check, because it turns "how busy the machine was"
 * into a lost point on a build that did nothing wrong.
 *
 * The measurement it is set against: on a host running nine of these projects at
 * once (load average ~450), the slowest engine suite measured — a twenty-five-
 * board cascade sweep — took about 40 s against about 6 s quiet, and the
 * engineless sibling of the same project lost four points to a sixty-second
 * allowance under the same conditions. The runner caps the WHOLE suite run at
 * forty-five minutes (`VITEST_TIMEOUT`, `crates/core/src/vitest_validator.rs`),
 * so five minutes — a ninth of that cap — can only be crossed by a single file on
 * a host where the whole run was already lost. Below that, no correct build loses
 * a point to the clock, and a hung build is still bounded twice over.
 */
const DEFAULT_TEST_TIMEOUT_MS = 300_000;

/** The ceiling on a suite's own setup and teardown. See `hookTimeout` above. */
const DEFAULT_HOOK_TIMEOUT_MS = 120_000;

/**
 * The vitest project a case's `validation/<engine>/vitest.config.ts` exports:
 *
 * ```ts
 * import { defineEngineValidationConfig } from "./case-harness/engine/vitest-config";
 * export default defineEngineValidationConfig({
 *   root: new URL("..", import.meta.url).pathname,
 * });
 * ```
 *
 * Everything but the dials is fixed, because everything but the dials is what
 * makes a staged validator project one shape the runner can drive: the project's
 * name, the suites it collects, and the refusal to pass a run that collected
 * nothing.
 */
export function defineEngineValidationConfig(
  options: EngineValidationConfigOptions,
): ViteUserConfig {
  return defineConfig({
    root: options.root,
    test: {
      name: "validation",
      include: ["validation/**/*.test.ts"],
      environment: "node",
      // A missing validator is a broken suite, not a passing one.
      passWithNoTests: false,
      coverage: { enabled: false },
      ...(options.maxWorkers === undefined
        ? {}
        : { maxWorkers: options.maxWorkers }),
      testTimeout: options.testTimeout ?? DEFAULT_TEST_TIMEOUT_MS,
      hookTimeout: options.hookTimeout ?? DEFAULT_HOOK_TIMEOUT_MS,
    },
  });
}
