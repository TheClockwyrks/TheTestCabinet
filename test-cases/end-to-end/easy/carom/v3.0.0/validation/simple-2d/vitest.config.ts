// Carom — the vitest project the CASE's validators run as. CASE-PROVIDED.
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
// The environment is `node`. The runtime takes every measurement from the
// `SurfaceMetrics` the harness supplies, so these suites need no DOM.

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
    // Every frame this project advances is a frame the runtime RENDERS, so a
    // check that plays a rally to the speed ceiling costs thousands of real
    // renders, and how long those take is a property of the machine rather than
    // of the build. So the ceiling below is not what the checks cost — it is set
    // several times above the slowest a correct build has been measured at on a
    // machine loaded far past anything a run should meet, because a timeout that
    // fails a correct build is a defect in the check rather than a fact about
    // the build.
    testTimeout: 300_000,
    // Left unset, a hook falls back to vitest's own 10 s, which is nothing like
    // the allowance the checks themselves get; a harness is built in a
    // `beforeEach`, so a hook that expires fails the check just as a timeout
    // does.
    hookTimeout: 300_000,
    // Capped rather than left to the core count, for the same reason the
    // engineless project caps it: the host running this is running a model's
    // build under it, and a project that fans out across every core contends
    // with itself, so each suite takes several times longer than it does alone.
    maxWorkers: 4,
    minWorkers: 1,
  },
});
