// Orrery — the vitest project the CASE's validators run as, under the SIMPLE 2D
// engine. CASE-PROVIDED.
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
// build's modules — `../src/game`, `../src/constants` — by the same relative
// paths the build itself uses, and reads the produced files under `assets/` where
// the build committed them. It is derived from this file's own URL rather than
// from the working directory, so the command above works from anywhere.
//
// THE ENVIRONMENT IS `node`. The engine takes every measurement from the
// `SurfaceMetrics` the harness supplies and draws through an `@napi-rs/canvas`
// canvas the harness owns, so these suites need no DOM. What a browser would
// otherwise have supplied — a `fetch` for the produced files, a
// `createImageBitmap` to decode one, and an `AudioContext` to bind a cue — the
// harness installs itself; see `harness.ts`.

import { defineConfig } from "vitest/config";

export default defineConfig({
  root: new URL("..", import.meta.url).pathname,
  test: {
    name: "validation",
    include: ["validation/**/*.test.ts"],
    environment: "node",
    // A missing validator is a broken suite, not a passing one.
    passWithNoTests: false,
    coverage: { enabled: false },
    // Orrery's pointer operations take effect the moment they are called, so a
    // whole machine is placed without advancing the game. The ceiling is for the
    // checks that RUN a machine: a reference solution is allowed
    // `CAMPAIGN_REFERENCE_CYCLES` (600) cycles to complete, and a cycle is a
    // dozen frames, so a course walk is thousands of frames of a real simulation.
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
