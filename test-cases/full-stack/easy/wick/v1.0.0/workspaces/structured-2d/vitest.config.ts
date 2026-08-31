// Supplied with the project. Do not edit.
//
// This config names the build's own tests: the `*.test.ts` files written beside
// the sources under `src/`. They run in process, in Node, with no browser and no
// DOM. The engine stands up over an `@napi-rs/canvas` canvas and a surface and
// clock of the test's own, so a night is posed through the debug surface,
// advanced a counted number of frames with `engine.advance`, and read back from
// the world's state. The engine's documentation, seeded at `engine/`, carries a
// complete worked example of that shape.
//
// Coverage is measured over `src/` alone, so it reports the code this build
// actually ships. `passWithNoTests` keeps a build that has not written its tests
// yet reporting an honest zero rather than a runner error.

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "build",
    include: ["src/**/*.test.ts"],
    environment: "node",
    passWithNoTests: true,
    coverage: {
      provider: "v8",
      reporter: ["text"],
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts"],
    },
  },
});
