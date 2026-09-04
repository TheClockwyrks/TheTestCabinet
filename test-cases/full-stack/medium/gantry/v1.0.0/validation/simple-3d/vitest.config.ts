// Gantry — the vitest project the CASE's validators run as, for a build on the
// SIMPLE 3D engine. CASE-PROVIDED.
//
// A project of its own, separate from the build's `vitest.config.ts` at the
// workspace root. The two never mix: the build's config names `src/**/*.test.ts`
// and measures coverage over `src/`, so the tests a build wrote are counted and
// covered on their own, and the verdict rests on the checks in this directory
// alone. A build cannot reach the verdict by writing a test, and a case's check
// cannot flatter the build's coverage.
//
//   npx vitest run                                       # the build's own tests
//   npx vitest run --config validation/vitest.config.ts  # the case's validators
//
// THE ROOT IS THE WORKSPACE, NOT THIS DIRECTORY, so a validator resolves the
// build's modules by the same relative paths the build itself uses —
// `../src/game.ts` for the game the engine drives — and reads a produced asset
// off `assets/` by the same path `specs/assets.md` fixes for it. It is derived
// from this file's own URL rather than from the working directory, so the command
// above works from anywhere. In the staged project this file is
// `<workspace>/validation/vitest.config.ts`, so `..` is the workspace.
//
// THE ENVIRONMENT IS `node`, AND THERE IS NO BROWSER. A suite stands the engine
// up over canvases and a clock of its own, in this process, so nothing here needs
// a DOM: the engine's own `SurfaceMetrics` seam supplies the element size, the
// device pixel ratio and the event target, and `harness.ts` supplies the `webgl2`
// context, the asset transport and the audio decoder the host does not carry.
// What that costs is the scene's pixels, which no check in this project reads,
// and the engine's recorder, whose VP9 encoder and `emitReplay` command both want
// a browser — so every point this case declares is backed by a still rather than a
// recording, which `harness.ts` states in full. What it buys is a run that needs
// no browser, no server and no wall-clock time.
//
// A missing validator is a broken suite, not a passing one, so `passWithNoTests`
// is off.

import { defineConfig } from "vitest/config";

export default defineConfig({
  root: new URL("..", import.meta.url).pathname,
  test: {
    name: "validation",
    include: ["validation/**/*.test.ts"],
    environment: "node",
    passWithNoTests: false,
    coverage: { enabled: false },
    // A Gantry scenario is real structural simulation: a reference tape is a
    // thousand ticks of two linear solves per tick, and a crane is posed one edit
    // at a time before any of it starts. Those drives run in this process rather
    // than in a browser, so a file in flight is a core in use: the ceiling has to
    // hold when every worker is simulating at once, not only when one file runs
    // alone. Three minutes is that ceiling. It is a cap on a hang, not a budget
    // anything spends, and the whole run is capped again from outside.
    testTimeout: 180_000,
    hookTimeout: 60_000,
  },
});
