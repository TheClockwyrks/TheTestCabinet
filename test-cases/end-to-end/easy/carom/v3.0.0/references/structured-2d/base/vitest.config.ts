// CASE-PROVIDED. Do not edit.
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
