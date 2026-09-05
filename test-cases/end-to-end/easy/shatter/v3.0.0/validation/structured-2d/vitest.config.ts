// Shatter — the vitest project the CASE's validators run as. CASE-PROVIDED.
//
// A project of its own, separate from the build's `vitest.config.ts` at the
// workspace root. The two never mix: the build's config names `src/**/*.test.ts`
// and measures coverage over `src/`, so the tests a build wrote are counted and
// covered on their own, and the verdict rests on the checks in this directory
// alone. A build cannot reach the verdict by writing a test, and a case's check
// cannot flatter the build's coverage.
//
//   npx vitest run                                       # the build's own tests
//   npx vitest run --config validation/vitest.config.ts  # the case's validators
//
// The root is the workspace, not this directory, so a validator resolves the
// build's modules by the same relative paths the build itself uses. It is derived
// from this file's own URL rather than from the working directory, so the command
// above works from anywhere.
//
// The environment is `node`: every suite stands the engine up over a headless
// canvas with a `ConstantClock(TICK_MS)` of its own and steps it with
// `engine.advance`, so none of them needs a DOM.

import { defineConfig } from "vitest/config";

export default defineConfig({
  root: new URL("..", import.meta.url).pathname,
  test: {
    name: "validation",
    include: ["validation/**/*.test.ts"],
    environment: "node",
    // A missing validator is a broken suite, not a passing one.
    passWithNoTests: false,
    coverage: { enabled: false },
    // EIGHT WORKERS, NOT ONE PER CORE.
    //
    // Left unset, vitest fans this project out across every core the machine has,
    // and each worker of this project is a whole engine stepping a simulation:
    // the project then competes with itself for the processor it is already
    // saturating, and holds one engine's worth of memory per worker while it
    // does. The host running this is also running a model's build, so the cores
    // were never all this project's to take. That is the whole of the argument
    // for the cap, and it does not rest on any ceiling: eight is what a project
    // that saturates a core per worker may take from a host it shares.
    //
    // WHAT EIGHT ACTUALLY COSTS, MEASURED. Against the `warhead` reference build,
    // 291 suite files and 342 checks finished in 14.7 s of wall clock at eight
    // workers, with the slowest FILE at 3.6 s (`saucer/at-most-one-at-a-time`,
    // which samples two minutes of game time every tick). The reading was taken
    // on a twenty-core box carrying four of these case worktrees at load average
    // ~13 — a loaded host rather than an idle one, and it counted one suite since
    // removed, so it is an upper bound rather than a best case. Against that, the
    // fifteen minutes
    // `guides/authoring/writing-debug-apis-and-validators.md` asks a case to
    // finish in, and the forty-five the runner caps the WHOLE suite run at
    // (`VITEST_TIMEOUT`, `crates/core/src/vitest_validator.rs`), are both orders
    // of magnitude away. Nothing here is close to either, so the worker count is
    // set by what the host can spare rather than by a deadline.
    maxWorkers: 8,
    // A ceiling on a suite that never terminates, not a schedule any check is
    // written to. Every scenario here is stepped in whole ticks and none of them
    // measures the wall clock, so what a check costs is processor time on a host
    // this project does not own — and a check that a busy host pushes past its
    // allowance is a check that failed a correct build for a fact about the
    // machine. The figure is therefore many times the longest scenario rather
    // than a snug fit around it: the longest here — `saucer/at-most-one-at-a-time`
    // sampling two minutes of game time every tick, the avoidance sweep's 54
    // crossings — run in a couple of seconds of processor time, and five minutes
    // is room for a host twenty times oversubscribed.
    testTimeout: 300_000,
    hookTimeout: 300_000,
  },
});
