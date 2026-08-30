// Cascade — the vitest project the CASE's validators run as. CASE-PROVIDED.
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
// The root is the workspace, not this directory, so a validator resolves the
// build's modules by the same relative paths the build itself uses. It is derived
// from this file's own URL rather than from the working directory, so the command
// above works from anywhere.
//
// The environment is `node`. The Structured 2D engine takes every measurement
// from the `SurfaceMetrics` the harness supplies, so these suites need no DOM —
// and the one thing a build DOES need a browser for, the offscreen surface the
// victory cascade paints its trail onto, `validation/canvas-shim.ts` stands up
// over `@napi-rs/canvas` before any module of the build is evaluated.

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
    // A cascade advanced in frames of 1/240 s is thousands of frames of real
    // integration; generous here, and still a fraction of a second in practice.
    testTimeout: 60_000,
  },
});
