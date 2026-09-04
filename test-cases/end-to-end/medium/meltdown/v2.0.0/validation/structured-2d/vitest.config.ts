// Meltdown — the vitest project the CASE's validators run as. CASE-PROVIDED.
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
// The environment is `node`. The engine runs over the canvas and the
// `SurfaceMetrics` the harness supplies, so these suites need no DOM.

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
    // A posed floor is advanced with `engine.advance`, so even a scenario that
    // spends a minute of game time costs milliseconds. The ceiling is for the
    // sweeps that release a whole wave against a maze, and for the handful of
    // checks that spend REAL time: a question about whether time passes is
    // measured on the build's own clock, so those hand the frame loop back and
    // wait for the build's own clock to gain the seconds the leg names
    // (`harness.ts`, Windows on the build's own clock). A starved loop makes such
    // a leg take longer, never cover less, which is the other half of why the
    // ceiling here is a ceiling on the host.
    //
    // WHAT THE WHOLE CHECKLIST COSTS HERE, MEASURED AGAINST THE CONFORMANT
    // REFERENCE. `guides/authoring/writing-debug-apis-and-validators.md` asks a
    // case to finish in fifteen minutes on a two-core host. On this repository's
    // twenty-core development machine, which is shared and never idle, these 376
    // points came to 16 s of wall clock across all its cores at a load average
    // of about fifteen, and to 154 s pinned to two of them with `taskset` at a
    // load average of about thirty. The engineless project is the one that comes
    // close to the budget, because it drives a browser; this one runs the same
    // scenarios in process and does not.
    //
    // TEN MINUTES, AND IT IS A CEILING ON THE HOST RATHER THAN A TOLERANCE ON
    // THE BUILD. No validator in this project asserts anything about how long it
    // took, so this figure can only ever turn a slow machine into a failing point
    // — and a point taken off a build for the load on the runner that scored it
    // is exactly what a per-check ceiling must never produce.
    //
    // WHY THREE MINUTES WAS NOT ENOUGH, MEASURED RATHER THAN GUESSED. On this
    // repository's own twenty-core machine, with the nine engine-and-case
    // checklists of the surrounding suite running at once and the load average
    // between two hundred and four hundred and fifty, a check gets a percent or
    // two of a core: its wall clock is ten to twenty times its idle wall clock,
    // and the arithmetic it does is unchanged. Measured that way the longest
    // suites here — the ones that drive a minute of game time frame by frame —
    // ran to about two hundred and fifty seconds against the twenty-odd they take
    // idle, and failed points they pass idle. Ten minutes is a margin of nearly
    // thirty against those idle figures, which covers a machine several times
    // busier than the worst this one has been measured at.
    //
    // IT CANNOT RUN AWAY WITH THE RUN, because the runner caps the WHOLE vitest
    // invocation at forty-five minutes of wall clock regardless
    // (`VITEST_TIMEOUT`, `crates/core/src/vitest_validator.rs`). A hung suite is
    // still bounded, and the figure here is between a fifth and a quarter of that
    // cap, so one stuck check cannot be the thing that spends it.
    testTimeout: 600_000,
    // The hook budget matches, for the same reason: `beforeEach` builds a harness
    // and poses a floor, and a host slow enough to need the ceiling above is slow
    // enough to need it here. It is the ceiling the engineless project already
    // carries.
    hookTimeout: 600_000,
  },
});
