// Supplied with the project. Do not edit.
//
// This config names the BUILD'S OWN tests: the `*.test.ts` files written beside
// the sources under `src/`. They run in process, in Node, with no browser and no
// DOM — the engine runs over an `@napi-rs/canvas` canvas and a `SurfaceMetrics`
// of the test's own, so a maze is posed, stepped with `engine.advance`, and read
// back from the game's state. The engine's documentation, seeded at `engine/`,
// carries a complete worked example of that shape.
//
// Coverage is measured over `src/` alone, so it reports the code this build
// actually ships. `passWithNoTests` keeps a build that has not written its tests
// yet reporting an honest zero rather than a runner error.
//
// The suite's results and its coverage are read back off two report files this
// config writes, never off what the command printed, so the recorded figures do
// not move when a runner restyles its terminal output. Both are written into
// `coverage/`, which this project already ignores in git and in Prettier, so a
// report stays out of the commit and out of `prettier --check`.
//
//   coverage/test-report.json       the totals, a row per test file, and each
//                                   failure with its message
//   coverage/coverage-summary.json  istanbul's four metrics, whole and per file
//
// The `default` reporter prints for a person reading the log; nothing reads
// back what this command prints.
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
    reporters: ["default", "json"],
    outputFile: { json: "coverage/test-report.json" },
    coverage: {
      provider: "istanbul",
      reporter: ["json-summary"],
      // A failing suite is exactly the build whose coverage is most worth having,
      // and vitest writes no coverage report on failure without this.
      reportOnFailure: true,
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/constants.ts", "src/main.ts"],
    },
  },
});
