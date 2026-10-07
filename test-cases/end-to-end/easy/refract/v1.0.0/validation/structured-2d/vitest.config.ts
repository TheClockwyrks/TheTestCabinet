// Refract — the vitest project the CASE's validators run as. CASE-PROVIDED.
//
// The whole of it is the shared `@clockwyrks/case-harness` package's factory,
// which fixes everything that makes a staged validator project one shape the
// runner can drive — the project's name, the suites it collects, the `node`
// environment, and the refusal to pass a run that collected nothing — and leaves
// this file the two values that are genuinely Refract's.
//
//   npx vitest run                                       # the build's own tests
//   npx vitest run --config validation/vitest.config.ts  # the case's validators
//
// The factory is imported by its own specifier rather than through the package's
// barrel, because it is loaded by vite's own config path before the test runtime
// exists and it is the file whose failure mode is "the project would not load at
// all".
import { defineEngineValidationConfig } from "./case-harness/engine/vitest-config";

export default defineEngineValidationConfig({
  // The workspace, not this directory, so a validator resolves the build's
  // modules by the same relative paths the build itself uses. Derived from this
  // file's own URL rather than from the working directory, so the command above
  // works from anywhere.
  root: new URL("..", import.meta.url).pathname,
  // WHAT A TIMEOUT IS FOR, AND WHAT IT MUST NOT DO. Nothing this project
  // measures is taken from the wall clock: every check drives the game frame by
  // frame through the engine's host interface and asserts on what the build's
  // own snapshot reports. The one wall clock left is this allowance — and an
  // allowance a correct build can cross is a defect in the check, because it
  // turns "how busy the machine was" into a lost point on a build that did
  // nothing wrong.
  //
  // The measurement it is set against: on a host running nine of these projects
  // at once (load average ~450), the slowest suite here — a twenty-five-board
  // cascade sweep — took about 40 s against about 6 s quiet, and the engineless
  // sibling of this project lost four points to a sixty-second allowance under
  // the same conditions. The runner caps the WHOLE suite run at forty-five
  // minutes (`VITEST_TIMEOUT`, `crates/core/src/vitest_validator.rs`), so five
  // minutes — a ninth of that cap — can only be crossed by a single file on a
  // host where the whole run was already lost.
  testTimeout: 300_000,
  // Vitest defaults an unset hook allowance to TEN SECONDS, which is the
  // tightest wall clock in the project and the one least related to anything the
  // build does — a `beforeEach` that builds a harness over the engine can cross
  // it on a loaded host alone. Set explicitly, for the same reason the test
  // allowance is.
  hookTimeout: 120_000,
});
