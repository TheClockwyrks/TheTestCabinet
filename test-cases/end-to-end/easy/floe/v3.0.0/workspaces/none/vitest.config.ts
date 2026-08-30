// Supplied with the project. Do not edit.
//
// This config names the BUILD'S OWN tests: the `*.test.ts` files written beside
// the sources under `src/`. They run in process, in Node, with no browser and no
// DOM. `@napi-rs/canvas` is installed for a test that needs a real 2D context to
// draw through, so a build can check what it renders without standing a browser
// up.
//
// A test that draws the critter also needs the seeded sprite art. Read the frames
// off the project's own `assets/` directory rather than through the page-relative
// path the game uses in the browser: a Node process has no page to resolve one
// against.
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
