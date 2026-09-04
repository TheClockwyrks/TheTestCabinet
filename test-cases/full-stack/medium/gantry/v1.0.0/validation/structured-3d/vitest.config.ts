// Gantry — the vitest project the CASE's validators run as. CASE-PROVIDED.
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
// build's module by the same relative path the build itself uses — `src/game.ts`
// for the definition the engine is created over — and the harness finds the
// produced files under `assets/` where `specs/assets.md` had the build commit
// them. It is derived from this file's own URL rather than from the working
// directory, so the command above works from anywhere: in the staged project this
// file is `<workspace>/validation/vitest.config.ts`, so `..` is the workspace.
//
// THE ENVIRONMENT IS `node`, AND THERE IS NO BROWSER ANYWHERE IN THIS PROJECT.
// A suite stands the engine up itself, over canvases and a clock of its own, and
// drives it with `engine.advance` in this process. What the engine expects a
// browser to supply — a `webgl2` context, `fetch`, an audio context — the harness
// supplies instead; `validation/host.ts` is the whole of that adapter and says
// what each of the three is worth. What it does NOT supply is the engine's
// recorder, whose VP9 encoder and `emitReplay` command both want a browser — so
// every point this case declares is backed by a still rather than a recording,
// which `harness.ts` states in full.
//
// `passWithNoTests` is `false` because a missing validator is a broken suite
// rather than a passing one.

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
    // alone. It is a cap on a hang rather than a budget anything spends.
    testTimeout: 180_000,
    hookTimeout: 60_000,
  },
});
