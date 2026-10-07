// Meltdown — the vitest project the CASE's validators run as. CASE-PROVIDED.
//
//   npx vitest run                                       # the build's own tests
//   npx vitest run --config validation/vitest.config.ts  # the case's validators
//
// Everything but the two dials below is the shared `@clockwyrks/case-harness`
// package's factory, because everything but the dials is what makes a staged
// validator project one shape the runner can drive: the project's name, the
// suites it collects, the `node` environment the engine runs in, and the refusal
// to pass a run that collected nothing. It is a project of its own, separate from
// the build's `vitest.config.ts` at the workspace root, so a build cannot reach
// the verdict by writing a test and a case's check cannot flatter the build's
// coverage.
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
  // A posed floor is advanced with `engine.advance`, so even a scenario that
  // spends a minute of game time costs milliseconds; the ceiling is for the
  // sweeps that release a whole wave against a maze.
  //
  // WHAT THE WHOLE CHECKLIST COSTS HERE, MEASURED AGAINST THE CONFORMANT
  // REFERENCE. `guides/authoring/writing-debug-apis-and-validators.md` asks a
  // case to finish in fifteen minutes on a two-core host. On this repository's
  // twenty-core development machine, which is shared and never idle, these 376
  // points came to 16 s of wall clock across all its cores at a load average of
  // about fifteen, and to 154 s pinned to two of them with `taskset` at a load
  // average of about thirty. The engineless project is the one that comes close
  // to the budget, because it drives a browser; this one runs the same scenarios
  // in process and does not.
  //
  // TEN MINUTES, AND IT IS A CEILING ON THE HOST RATHER THAN A TOLERANCE ON THE
  // BUILD. No validator in this project asserts anything about how long it took,
  // so this figure can only ever turn a slow machine into a failing point — and a
  // point taken off a build for the load on the runner that scored it is exactly
  // what a per-check ceiling must never produce.
  //
  // WHY THREE MINUTES WAS NOT ENOUGH, MEASURED RATHER THAN GUESSED. On this
  // repository's own twenty-core machine, with the nine engine-and-case
  // checklists of the surrounding suite running at once and the load average
  // between two hundred and four hundred and fifty, a check gets a percent or two
  // of a core: its wall clock is ten to twenty times its idle wall clock, and the
  // arithmetic it does is unchanged. Measured that way the longest suites here —
  // the ones that drive a minute of game time frame by frame — ran to about two
  // hundred and fifty seconds against the twenty-odd they take idle, and failed
  // points they pass idle. Ten minutes is a margin of nearly thirty against those
  // idle figures, which covers a machine several times busier than the worst this
  // one has been measured at, and it is well past the package's own five-minute
  // default.
  //
  // IT CANNOT RUN AWAY WITH THE RUN, because the runner caps the WHOLE vitest
  // invocation at forty-five minutes of wall clock regardless (`VITEST_TIMEOUT`,
  // `crates/core/src/vitest_validator.rs`). A hung suite is still bounded, and the
  // figure here is between a fifth and a quarter of that cap, so one stuck check
  // cannot be the thing that spends it.
  testTimeout: 600_000,
  // The hook budget matches, for the same reason: `beforeEach` builds a harness
  // and poses a floor, and a host slow enough to need the ceiling above is slow
  // enough to need it here. It is the ceiling the engineless project already
  // carries, and it raises the package's own two-minute default.
  hookTimeout: 600_000,
});
