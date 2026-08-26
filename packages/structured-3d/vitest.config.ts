import { defineConfig } from "vitest/config";

// The suite defaults to node rather than jsdom: the engine takes every
// measurement through a `SurfaceMetrics` and renders through the in-process
// WebGL2 context `@test-cabinet/headless-webgl2` serves, so most tests build
// and draw with no document at all — the same environment the validator docs
// prescribe for a case's own suites. The few behaviors that genuinely need a
// DOM — the default surface's measurements and listeners, CSS-size pinning —
// opt into jsdom per file with a `// @vitest-environment jsdom` pragma, rather
// than the whole suite paying for a document it never reads.
export default defineConfig({
  test: {
    environment: "node",
  },
});
