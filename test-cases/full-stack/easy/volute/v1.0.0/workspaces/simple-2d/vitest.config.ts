// Supplied with the project. Do not edit.
//
// This config names the build's own tests: the `*.test.ts` files written beside
// the sources under `src/`. They run in process, in Node, with no browser and no
// DOM. The engine runs over an `@napi-rs/canvas` canvas and a `ConstantClock`,
// so a train is posed through the debug surface, advanced a counted number of
// frames, and read back from the game's state; the engine's `debug.md` and
// `frame.md`, seeded under `engine/`, show that shape.
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
