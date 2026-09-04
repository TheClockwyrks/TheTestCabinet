// Supplied with the project. Do not edit.
//
// This config names the build's own tests: the `*.test.ts` files written beside
// the sources under `src/`. They run in process, in Node, with no browser and no
// DOM. The engine runs over an `@napi-rs/canvas` canvas and a `ConstantClock`,
// so a train is posed through the debug surface, advanced a counted number of
// frames, and read back from the game's state; the engine's `debug.md` and
// `frame.md`, seeded under `engine/`, show that shape.
//
// The suite's results and its coverage are read back off two report files this
// config writes, never off what the command printed, so a recorded figure does
// not move when a runner restyles its terminal output. `coverage/` holds both:
// it is the one directory this project ignores in git AND in Prettier, which
// keeps a report out of the commit and out of `prettier --check`.
//
//   coverage/test-report.json       the totals, a row per test file, and each
//                                   failure with its message
//   coverage/coverage-summary.json  istanbul's four metrics, whole and per file
//
// `reportOnFailure` is what makes a red suite write its coverage at all, which
// is the suite whose coverage is most worth having.
//
// Coverage is measured by ISTANBUL rather than by v8. Istanbul instruments this
// project's own TypeScript, so a branch is an `if`, a ternary, a logical
// operator, a default parameter or a switch case in the source a reader is
// looking at, and the figure does not shift with a V8 or vitest upgrade through
// a source-map remap alone.
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
