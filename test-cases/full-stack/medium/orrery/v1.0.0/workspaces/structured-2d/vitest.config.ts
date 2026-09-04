// Supplied with the project. Do not edit.
//
// This config names the BUILD'S OWN tests: the `*.test.ts` files written beside
// the sources under `src/`. They run in process, in Node, with no browser and no
// DOM — the engine stands up over an `@napi-rs/canvas` canvas and a
// `SurfaceMetrics` and clock of the test's own, so a machine is posed, advanced
// a counted number of frames with `engine.advance`, and read back from the
// world's state. The engine's documentation, seeded at `engine/`, carries a
// complete worked example of that shape.
//
// Coverage is measured over `src/` alone, so it reports the code this build
// actually ships. `passWithNoTests` keeps a build that has not written its tests
// yet reporting an honest zero rather than a runner error.
//
// Both reporters write a FILE as well as the table they print, into `coverage/`,
// which this project already ignores in git and in Prettier. The suite's results
// and its coverage figures are read back out of those two files rather than
// scraped from what the command printed, so restyling a reporter's terminal
// output cannot move a recorded number.
//
// Coverage is measured by ISTANBUL rather than by v8. Istanbul instruments the
// source, so a branch is an `if`, a ternary, a logical operator, a default
// parameter or a switch case, located in this project's own TypeScript — which
// is what a reader of a branch-coverage figure believes they are being told. The
// v8 provider derives its branches from V8's block counters remapped through
// source maps; those numbers do not correspond to logical branches in
// TypeScript, and they can shift with a V8 or vitest upgrade through the remap
// alone, with no change to this code. Istanbul's instrumentation is
// deterministic given the source and the plugin version, and it emits its JSON
// summary natively rather than through a remap. Its one cost is that
// instrumented code runs slower, which a suite of this size can afford.
//
// `src/constants.ts` and `src/main.ts` are supplied with the project and must
// not be edited, so they are left out of coverage: they are not this build's
// work, and counting them would put lines the build never wrote into its
// denominator.

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "build",
    include: ["src/**/*.test.ts"],
    environment: "node",
    passWithNoTests: true,
    // `default` keeps the human-readable run in the log; `json` writes the
    // machine-readable report the recorded results are read out of.
    reporters: ["default", "json"],
    outputFile: { json: "coverage/test-report.json" },
    coverage: {
      provider: "istanbul",
      reporter: ["text", "json-summary"],
      // A failing suite is exactly the build whose coverage is most worth
      // having, and vitest writes no coverage report on failure without this.
      reportOnFailure: true,
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/constants.ts", "src/main.ts"],
    },
  },
});
