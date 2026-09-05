// Supplied with the project. Do not edit.
//
// This config names the BUILD'S OWN tests: the `*.test.ts` files written beside
// the sources under `src/`. They run in process, in Node, with no browser and no
// DOM — the engine runs over an `@napi-rs/canvas` canvas and a `SurfaceMetrics`
// of the test's own, so a strait is posed, stepped, and read back from the game's
// state. The engine's documentation, seeded at `engine/`, carries a complete
// worked example of that shape.
//
// A test that draws the critter also needs the seeded sprite art, which the
// engine's loader reaches for through `fetch` and `createImageBitmap`. A Node
// process has no page to resolve a relative URL against, so such a test stands
// both globals up over the project's own `assets/` directory for the life of the
// file and restores them afterwards.
//
// `tsconfig.json` declares no global type packages, so the game's own code is
// typed against the browser alone. `@types/node` is installed for the tests, and
// a test module that reads the disk asks for it with `/// <reference types="node"
// />` at its top, which scopes Node's types to that one module.
//
// The suite's results and its coverage are read back off two report FILES this
// config writes, never off what the command printed, so a recorded figure does
// not move when a runner restyles its terminal output. `coverage/` holds both,
// and it is ignored in git and in Prettier alike, so a written report is neither
// committed nor format-checked.
//
//   coverage/test-report.json       the totals, a row per test file, and each
//                                   failure with its message
//   coverage/coverage-summary.json  istanbul's four metrics, whole and per file
//
// `reportOnFailure` is what makes a red suite write its coverage at all, and a
// red suite is the one whose coverage is most worth reading.
//
// Coverage is measured by ISTANBUL rather than by v8. Istanbul instruments the
// source, so a branch in the report is an `if`, a ternary, a logical operator, a
// default parameter or a switch case in this project's own TypeScript, which is
// what a reader of a branch figure takes it to mean. It is measured over the code
// THIS BUILD WROTE: `src/main.ts` and `src/constants.ts` are supplied with the
// project and may not be edited, so counting them would put lines the build never
// chose into its denominator. `passWithNoTests` keeps a build that has not
// written its tests yet reporting an honest zero rather than a runner error.

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
      reportOnFailure: true,
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/constants.ts", "src/main.ts"],
    },
  },
});
