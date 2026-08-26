import { defineConfig } from "vitest/config";

// The suite defaults to node rather than jsdom: the engine takes every
// measurement through a `SurfaceMetrics` and renders through the in-process
// WebGL2 context `@test-cabinet/headless-webgl2` serves, so most tests build
// and draw with no document at all — the same environment the validator docs
// prescribe for a case's own suites. The few behaviors that genuinely need a
// DOM — the default surface's measurements and listeners, CSS-size pinning —
// opt into jsdom per file with a `// @vitest-environment jsdom` pragma, rather
// than the whole suite paying for a document it never reads.

// The timeout is raised off vitest's 5 s default because these tests rasterize.
// A scenario here builds an engine over a software WebGL2 context and draws every
// frame of it on the CPU, so the slow ones measure seconds of real rasterizing
// rather than milliseconds of bookkeeping — several run past 3 s on this
// container, leaving under a factor of two against the default on a runner with a
// quarter of the cores, and the suite was observed timing out exactly that way
// under load. The bound is a hung-test guard, not a performance assertion:
// nothing here asserts on elapsed time, so raising it weakens no check while
// removing a flake that would present as a mysterious failure. Same reasoning,
// and the same shape, as the slow-timeout overrides `.config/nextest.toml` gives
// the Rust suite's genuinely expensive tests.
export default defineConfig({
  test: {
    environment: "node",
    testTimeout: 30_000,
  },
});
