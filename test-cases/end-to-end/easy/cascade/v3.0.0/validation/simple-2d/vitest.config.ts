// Cascade — the vitest project the CASE's validators run as. CASE-PROVIDED.
//
// The whole of it is the shared `@clockwyrks/case-harness` package's factory,
// which fixes everything that makes a staged validator project one shape the
// runner can drive — the project's name, the suites it collects, the `node`
// environment, and the refusal to pass a run that collected nothing — and leaves
// this file the values that are genuinely Cascade's.
//
//   npx vitest run                                       # the build's own tests
//   npx vitest run --config validation/vitest.config.ts  # the case's validators
//
// The factory is imported by its own specifier rather than through the package's
// barrel, because it is loaded by vite's own config path before the test runtime
// exists and it is the file whose failure mode is "the project would not load at
// all".
//
// The environment the factory fixes is `node`. The engine takes every measurement
// from the `SurfaceMetrics` the harness supplies, so these suites need no DOM, and
// the two browser drawing surfaces a build may reach for are stood up over
// `@napi-rs/canvas` by `canvas-shim.ts`, which `harness.ts` imports first.

import { defineEngineValidationConfig } from "./case-harness/engine/vitest-config";

export default defineEngineValidationConfig({
  // The workspace, not this directory, so a validator resolves the build's
  // modules by the same relative paths the build itself uses. Derived from this
  // file's own URL rather than from the working directory, so the command above
  // works from anywhere.
  root: new URL("..", import.meta.url).pathname,
  // HOW MANY SUITES RUN AT ONCE IS THE CASE'S FIGURE, NOT THE HOST'S. Left unset,
  // vitest fans out across whatever cores it finds, so the same checklist runs
  // eight ways on one machine and forty on another — and every suite here is a
  // forked node process holding an engine over its own canvas, so the fan-out
  // decides how much memory the run wants as much as how fast it goes. Eight is
  // what the engineless project settles on for the same reason and is enough to
  // use a machine of any ordinary size properly, while leaving the host something
  // to run the build's own work with.
  maxWorkers: 8,
  // WHAT THESE TWO BOUND, AND WHAT THEY MUST NOT DECIDE. A suite here is
  // deterministic: it poses a board, steps a counted number of frames, and reads
  // what they left, and not one assertion in the project reads a wall clock. What
  // a timeout can therefore only ever measure is how much of this machine the
  // suite was given — so a figure that a correct build can cross on a busy host is
  // not a bound on the build, it is a second verdict on the host, and it fails the
  // wrong thing.
  //
  // They are set from the longest scenario the checklist actually asks for, which
  // is why they are far above the factory's own defaults. The victory cascade runs
  // for a little over twelve seconds of game time and puts up to fifty-two cards
  // in the air; every frame of it renders every one of them into
  // `@napi-rs/canvas`, and a card face is five runs of text, so the run-out is the
  // most expensive thing this project does — around a minute of it on an idle
  // host. Ten minutes is that with an order of magnitude of room, which is what it
  // takes to survive a host running many times its own number of cores. It is
  // still a ceiling and not a target: a suite that hangs costs this and no more,
  // and every suite here finishes in seconds when the machine is its own.
  testTimeout: 600_000,
  // A hook builds a harness — an engine over a canvas, initialized — and a
  // scenario's arrangement often runs in one too, so it is held to the same
  // ceiling rather than to the factory's two minutes.
  hookTimeout: 600_000,
});
