// Supplied with the project. Do not edit.
//
// This config names the BUILD'S OWN tests: the `*.test.ts` files written beside
// the sources under `src/`. They run in process, in Node, with no browser and no
// DOM — the engine runs over an `@napi-rs/canvas` canvas and a `SurfaceMetrics`
// of the test's own, so a simulation is stepped with `engine.advance` and read
// back from the game's state. The engine's documentation, seeded at `engine/`,
// carries a complete worked example of that shape.
//
// The suite's results and its coverage are read back off two report files this
// config writes, never off what the command printed, so the recorded figures do
// not move when a runner restyles its terminal output. `coverage/` holds both:
// it is the one directory the project ignores in git AND in Prettier, which
// keeps a report out of the commit and out of `prettier --check`.
//
//   coverage/test-report.json       the totals, a row per test file, and each
//                                   failure with its message
//   coverage/coverage-summary.json  istanbul's four metrics, whole and per file
//
// Neither figure is read off the terminal; the `text` reporter prints its
// summary for whoever is watching the command.
//
// `reportOnFailure` is what makes a red suite write its coverage at all, which
// is the suite whose coverage is most worth having.
//
// Coverage is measured over the code THIS BUILD WROTE. `src/constants.ts` and
// `src/main.ts` are supplied with the project and may not be edited, so counting
// them would put lines the build never chose into its denominator.
// `passWithNoTests` keeps a build that has not written its tests yet reporting
// an honest zero rather than a runner error.

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
      reporter: ["text", "json-summary"],
      reportOnFailure: true,
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/constants.ts", "src/main.ts"],
    },
  },
});
