// Supplied with the project. Do not edit.
//
// This config names the BUILD'S OWN tests: the `*.test.ts` files written beside
// the sources under `src/`. They run in process, in Node, with no browser and no
// DOM — the engine runs over an `@napi-rs/canvas` canvas, a scripted clock, and
// a `SurfaceMetrics` of the test's own, so a scenario is stepped with
// `engine.advance` and read back from the world and the game's debug surface.
// The engine's documentation, seeded at `engine/`, carries a complete worked
// example of that shape.
//
// Coverage is measured over `src/` alone, so it reports the code this build
// actually ships. `passWithNoTests` keeps a build that has not written its tests
// yet reporting an honest zero rather than a runner error.
//
// Both reporters write a FILE as well as the table, into `coverage/`, which this
// project already ignores in git and in Prettier. The Test Cabinet reads the
// recorded test results and coverage figures out of those two files and never
// out of what the command printed, so a change to a reporter's terminal layout
// can no longer change a recorded figure.
//
// Coverage is measured by ISTANBUL, not by v8. Istanbul instruments the source,
// so a branch is an `if`, a ternary, a logical operator, a default parameter or a
// switch case, located in this project's own TypeScript — which is what a reader
// of a branch-coverage figure believes they are being told. The v8 provider
// derives its branches from V8's block counters remapped through source maps;
// those numbers do not correspond to logical branches in TypeScript, and they can
// shift with a V8 or vitest upgrade through the remap alone, with no change to
// this code. Istanbul's instrumentation is deterministic given the source and the
// plugin version, and it emits the JSON format that is stored natively rather
// than through a remap. Its one real cost is that instrumented code runs slower,
// and that is the cost this architecture does not pay: these commands run
// host-side after the run's container is gone, so a slow suite costs the run none
// of its runtime budget.
//
// `src/constants.ts` and `src/main.ts` are supplied with the project and must not
// be edited, so they are excluded from coverage: they are not this build's work
// and counting them would put case-authored lines in the build's denominator.

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "build",
    include: ["src/**/*.test.ts"],
    environment: "node",
    passWithNoTests: true,
    // `default` keeps the human-readable run in the log; `json` writes the
    // machine-readable report The Test Cabinet reads the recorded figures out of.
    // Nothing is ever scraped back out of the terminal output.
    reporters: ["default", "json"],
    outputFile: { json: "coverage/test-report.json" },
    coverage: {
      provider: "istanbul",
      reporter: ["text", "json-summary"],
      // A failing suite is exactly the build whose coverage is most worth having,
      // and vitest writes no coverage report on failure without this.
      reportOnFailure: true,
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/constants.ts", "src/main.ts"],
    },
  },
});
