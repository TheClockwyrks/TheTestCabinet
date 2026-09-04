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
    // milliseconds on a quiet host, and the longest suite in either engine
    // project — the stage-seven dive-gap window, which renders some three
    // thousand frames for a reading taken over twenty drawn gaps — measures 12 to
    // 14 s of them.
    //
    // The ceiling is not a figure any check is sized against: what it bounds is a
    // suite that never returns. It stands more than forty times over that longest
    // reading, because a check cut short by the runner reports a build's failure
    // that never happened, and how busy the machine was is not a property of the
    // build. Ten minutes rather than five for the room, which costs nothing: the
    // whole project finishes in twenty seconds, so this ceiling is reached only by
    // a suite that has genuinely stopped.
    testTimeout: 600_000,
    // The harness builds an engine and loads the seeded art in a `beforeEach`, so
    // the hook gets the same ceiling the suite does.
    hookTimeout: 600_000,
    // Every frame a suite advances is a frame the engine renders into an
    // `@napi-rs/canvas` surface, so these projects are CPU rather than round
    // trips, and left to itself vitest fans out over every core the box has.
    // Capped so the project does not contend with itself on a host that is
    // already running everything else.
    //
    // EIGHT IS FREE HERE, WHICH IT IS NOT FOR THE ENGINELESS PROJECT. There is no
    // globalSetup and no shared browser: a worker is its own process rendering
    // into its own surface. Measured over this whole project on an idle host,
    // four workers and eight give the SAME per-suite durations to within noise
    // while the wall clock halves — so unlike `validation/none`, raising the
    // count buys throughput without spending any of the headroom the per-test
    // ceiling above is there to provide.
    maxWorkers: 8,
  },
});
