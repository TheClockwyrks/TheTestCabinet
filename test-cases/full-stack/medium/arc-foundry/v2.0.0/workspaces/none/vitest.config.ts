// Supplied with the project. Do not edit.
//
// This config names the BUILD'S OWN tests: the `*.test.ts` files written beside
// the sources under `src/`. They run in process, in Node, with no browser and no
// DOM. `@napi-rs/canvas` is installed for a test that needs a real 2D context to
// draw through, so a build can check what it renders without standing a browser
// up.
//
// Coverage is measured over `src/` alone, so it reports the code this build
// actually ships. `passWithNoTests` keeps a build that has not written its tests
// yet reporting an honest zero rather than a runner error.
//
// Both reporters write a FILE as well as the table, into `coverage/`, which this
// project already ignores in git and in Prettier. The project's recorded test
// results and coverage figures are read out of those two files and never out of
// what the command printed, so a change to a reporter's terminal layout can no
// longer change a recorded figure.
//
// Coverage is measured by ISTANBUL, not by v8. Istanbul instruments the source,
// so a branch is an `if`, a ternary, a logical operator, a default parameter or a
// switch case, located in this project's own TypeScript — which is what a reader
// of a branch-coverage figure believes they are being told. The v8 provider
// derives its branches from V8's block counters remapped through source maps;
// those numbers do not correspond to logical branches in TypeScript, and they can
// shift with a V8 or vitest upgrade through the remap alone, with no change to
// this code. Istanbul's instrumentation follows from the source and the plugin
// version alone, and it emits the JSON format that is stored natively rather
// than through a remap. Its one real cost is that instrumented code runs slower,
// and these commands run outside the loop that builds the game, so a slow suite
// costs the build none of its time.

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "build",
    include: ["src/**/*.test.ts"],
    environment: "node",
    passWithNoTests: true,
    // `default` keeps the human-readable run in the log; `json` writes the
    // machine-readable report the recorded figures are read out of. Nothing is
    // ever scraped back out of the terminal output.
    reporters: ["default", "json"],
    outputFile: { json: "coverage/test-report.json" },
    coverage: {
      provider: "istanbul",
      reporter: ["json-summary"],
      // A failing suite is exactly the build whose coverage is most worth having,
      // and vitest writes no coverage report on failure without this.
      reportOnFailure: true,
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts"],
    },
  },
});
