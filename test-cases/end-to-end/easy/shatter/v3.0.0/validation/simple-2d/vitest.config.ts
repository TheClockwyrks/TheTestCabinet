// Shatter — the vitest project the CASE's validators run as. CASE-PROVIDED.
//
// A project of its own, separate from the build's `vitest.config.ts` at the
// workspace root. The two never mix: the build's config names `src/**/*.test.ts`
// and measures coverage over `src/`, so the tests a build wrote are counted and
// covered on their own, and the verdict rests on the checks in this directory
// alone. A build cannot reach the verdict by writing a test, and a case's check
// cannot flatter the build's coverage. Everything that is the same in every
// engine project — the project's name, the suites it collects, the `node`
// environment every engine measures through, the refusal to pass a run that
// collected nothing — is the shared harness's factory; what is below is the
// three dials this case measured for itself.
//
//   npx vitest run                                       # the build's own tests
//   npx vitest run --config validation/vitest.config.ts  # the case's validators
//
// The root is the workspace, not this directory, so a validator resolves the
// build's modules by the same relative paths the build itself uses. It is derived
// from this file's own URL rather than from the working directory, so the command
// above works from anywhere.

import { defineEngineValidationConfig } from "./case-harness/engine/vitest-config";

export default defineEngineValidationConfig({
  root: new URL("..", import.meta.url).pathname,
  // EIGHT WORKERS, NOT ONE PER CORE.
  //
  // Left unset, vitest fans this project out across every core the machine has,
  // and each worker of this project is a whole engine stepping a simulation: the
  // project then competes with itself for the processor it is already saturating,
  // and holds one engine's worth of memory per worker while it does. The host
  // running this is also running a model's build, so the cores were never all
  // this project's to take. That is the whole of the argument for the cap, and it
  // does not rest on any ceiling: eight is what a project that saturates a core
  // per worker may take from a host it shares.
  //
  // WHAT EIGHT ACTUALLY COSTS, MEASURED. Against the `warhead` reference build,
  // 291 suite files and 311 checks finished in 10.6 s of wall clock at eight
  // workers, with the slowest FILE at 1.1 s
  // (`saucer/entry-row-inside-the-range`). The reading was taken on a twenty-core
  // box carrying four of these case worktrees at load average ~13 — a loaded host
  // rather than an idle one, and it counted one suite since removed, so it is an
  // upper bound rather than a best case. Against that, the fifteen minutes
  // `guides/authoring/writing-debug-apis-and-validators.md` asks a case to finish
  // in, and the forty-five the runner caps the WHOLE suite run at
  // (`VITEST_TIMEOUT`, `crates/core/src/vitest_validator.rs`), are both orders of
  // magnitude away. Nothing here is close to either, so the worker count is set
  // by what the host can spare rather than by a deadline.
  maxWorkers: 8,
  // A ceiling on a suite that never terminates, not a schedule any check is
  // written to. Every scenario here is stepped in whole ticks and none of them
  // measures the wall clock, so what a check costs is processor time on a host
  // this project does not own — and a check that a busy host pushes past its
  // allowance is a check that failed a correct build for a fact about the
  // machine. The figure is therefore many times the longest scenario rather than
  // a snug fit around it: the longest here — `saucer/at-most-one-at-a-time`
  // sampling two minutes of game time every tick, the avoidance sweep's 54
  // crossings — run in a couple of seconds of processor time, and five minutes is
  // room for a host twenty times oversubscribed.
  testTimeout: 300_000,
  // The same allowance for a hook, which here builds an engine and awaits the
  // build's own `initialize`: a `beforeEach` that crosses a ceiling is a lost
  // point on a build that did nothing wrong, exactly as a check that does.
  hookTimeout: 300_000,
});
