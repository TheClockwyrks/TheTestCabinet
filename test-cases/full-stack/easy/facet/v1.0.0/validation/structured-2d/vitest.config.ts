// Facet — the vitest project the CASE's validators run as. CASE-PROVIDED.
//
// SHARED FILE. Byte-identical in `validation/simple-2d/` and
// `validation/structured-2d/`, the two directories a headless engine run lives
// in. Nothing here names an engine: both projects are stood up the same way,
// so it is copied between them rather than re-derived. An edit belongs in both
// copies at once; two copies that differ are a defect in the case.
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
// build's modules by the same relative paths the build itself uses. It is
// derived from this file's own URL rather than from the working directory, so
// the command above works from anywhere and works both in the case's own
// `validation/simple-2d/` and in the `validation/` the runner stages it to.
//
// The environment is `node`. The engine takes every measurement from the
// `SurfaceMetrics` the harness supplies, so these suites need no DOM — only the
// four globals `setup.ts` installs.
//
// There is no `globalSetup` and no worker cap: nothing is shared between files,
// so each suite stands its own build up in its own worker.

import { defineConfig } from "vitest/config";

export default defineConfig({
  root: new URL("..", import.meta.url).pathname,
  test: {
    name: "validation",
    include: ["validation/**/*.test.ts"],
    environment: "node",
    setupFiles: ["validation/setup.ts"],
    // A missing validator is a broken suite, not a passing one.
    passWithNoTests: false,
    coverage: { enabled: false },
    // A chain driven to its cap is a thousand frames of real simulation, and a
    // build's initialize decodes every produced file it ships; generous here,
    // and still a fraction of a second in practice.
    testTimeout: 60_000,
  },
});
