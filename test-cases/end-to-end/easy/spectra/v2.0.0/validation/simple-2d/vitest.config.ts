// Spectra — the vitest project the CASE's validators run as. CASE-PROVIDED.
//
// A project of its own, separate from the build's `vitest.config.ts` at the
// workspace root. The two never mix: the build's config names `src/**/*.test.ts`
// and measures coverage over `src/`, so the tests a build wrote are counted and
// covered on their own, and the verdict rests on the suites in this directory
// alone. A build cannot reach the verdict by writing a test, and a case's
// validator cannot flatter the build's coverage.
//
//   npx vitest run                                       # the build's own tests
//   npx vitest run --config validation/vitest.config.ts  # the case's validators
//
// The root is the workspace, not this directory, so a validator addresses the
// build by the same relative path the build itself uses, and reads the seeded art
// off the workspace's own `assets/` tree. It is derived from this file's own URL
// rather than from the working directory, so the command above works from
// anywhere.
//
// The environment is `node`. The engine runs over an `@napi-rs/canvas` canvas and
// a `SurfaceMetrics` of the harness's own, so these suites need no DOM: a
// scenario is posed through the surface `engine.debug` returns, advanced with the
// engine's own stepping, and read back from the snapshot. There is no page
// either, so nothing would resolve the relative URL the engine's asset loader
// fetches: `harness.ts` stands `fetch` and `createImageBitmap` up over that
// `assets/` tree for the life of each harness, so every scenario draws the field
// from the art the case seeded.

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
    // Every scenario is posed and stepped in process, so a suite costs
    // milliseconds on a quiet host. The ceiling is not a figure any check is
    // sized against: what it bounds is a suite that never returns, and it stands
    // far above the longest reading taken even on a host running a hundred other
    // jobs — a check cut short by the runner reports a build's failure that never
    // happened, and how busy the machine was is not a property of the build.
    testTimeout: 300_000,
    // The harness builds an engine and loads the seeded art in a `beforeEach`, so
    // the hook gets the same ceiling the suite does.
    hookTimeout: 300_000,
    // Every frame a suite advances is a frame the engine renders into an
    // `@napi-rs/canvas` surface, so these projects are CPU rather than round
    // trips, and left to itself vitest fans out over every core the box has.
    // Capped so the project does not contend with itself on a host that is
    // already running everything else.
    maxWorkers: 8,
  },
});
