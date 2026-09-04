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
    // HOW MANY SUITES RUN AT ONCE IS THE CASE'S FIGURE, NOT THE HOST'S. Left
    // unset, vitest fans out across whatever cores it finds, so the same
    // checklist runs eight ways on one machine and forty on another — and every
    // suite here is a forked node process holding an engine over its own canvas,
    // so the fan-out decides how much memory the run wants as much as how fast it
    // goes. Eight is what the engineless project settles on for the same reason
    // and is enough to use a machine of any ordinary size properly, while leaving
    // the host something to run the build's own work with.
    maxWorkers: 8,
    minWorkers: 1,
    // WHAT THESE TWO BOUND, AND WHAT THEY MUST NOT DECIDE. A suite here is
    // deterministic: it poses a board, steps a counted number of frames, and
    // reads what they left, and not one assertion in the project reads a wall
    // clock. What a timeout can therefore only ever measure is how much of this
    // machine the suite was given — so a figure that a correct build can cross on
    // a busy host is not a bound on the build, it is a second verdict on the
    // host, and it fails the wrong thing.
    //
    // They are set from the longest scenario the checklist actually asks for. The
    // victory cascade runs for a little over twelve seconds of game time and puts
    // up to fifty-two cards in the air; every frame of it renders every one of
    // them into `@napi-rs/canvas`, and a card face is five runs of text, so the
    // run-out is the most expensive thing this project does — around a minute of
    // it on an idle host. Ten minutes is that with an order of magnitude of room,
    // which is what it takes to survive a host running many times its own number
    // of cores. It is still a ceiling and not a target: a suite that hangs costs
    // this and no more, and every suite here finishes in seconds when the machine
    // is its own.
    testTimeout: 600_000,
    // A hook builds a harness — an engine over a canvas, initialized — and a
    // scenario's arrangement often runs in one too. Left unset it would take
    // vitest's own ten seconds, which is under the SETUP cost of a loaded host
    // and turns a build's verdict into a hook failure that names nothing.
    hookTimeout: 600_000,
  },
});
