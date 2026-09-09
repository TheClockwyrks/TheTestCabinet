// Deepcore — the vitest project the CASE's validators run as, under the SIMPLE 2D
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
// Everything but the root is the shared `@clockwyrks/case-harness` factory's,
// because everything else is what makes a staged validator project one shape
// the runner can drive: the project's name, the suites it collects, the `node`
// environment, the two allowances, and the refusal to pass a run that collected
// nothing.
//
// THE ENVIRONMENT IS `node`, and the factory fixes it. The engine takes every
// measurement from the `SurfaceMetrics` the harness supplies and draws through an
// `@napi-rs/canvas` canvas the harness owns, so these suites need no DOM. What a
// browser would otherwise have supplied — a `fetch` for the produced files and a
// `createImageBitmap` to decode one — the harness installs through the package's
// asset host; see `harness.ts`.
//
// THE HOOK ALLOWANCE IS THE FACTORY'S 120 s, which this project used to leave
// unset and so sat on vitest's TEN SECOND default — the tightest wall clock here
// and the one least related to anything the build does, since a `beforeEach` that
// stands an engine up and awaits the game's `initialize` can cross it on a loaded
// host alone.
//
// The factory is imported by its own specifier rather than through the package's
// barrel, because it is loaded by vite's own config path before the test runtime
// exists and it is the file whose failure mode is "the project would not load at
// all".

import { defineEngineValidationConfig } from "./case-harness/engine/vitest-config";

// NO DIALS. The minute this project used to name for `testTimeout` was sized
// against a healthy machine and the reference's own drawing, on the reading
// that a posed scenario costs milliseconds. A produced build run with the whole
// project in flight measured otherwise: `core-run/core-is-inexhaustible` at
// 48 s, and five more checks — `audio/music-bed-loops`,
// `fuel/thrust-burn-scales-with-world-size`, `assets/particle-on-pickup`,
// `hazards/impact-damage`, `economy/credits-survive-a-standard-death` — between
// 30 s and 37 s, every one a drive of hundreds of frames rendered through the
// engine onto the recording canvas. The specification fixes nothing about how a
// build draws the mine, so a build that blits every cell of a deep world each
// frame costs that canvas an order of magnitude more than one that draws the
// visible band, and it is a conforming build: every check here reads the
// snapshot and the picture and never the wall clock, so the only thing a low
// ceiling can take from such a build is a point it did nothing to lose. The
// factory's five minutes are the figure measured against a host running nine
// of these projects at once, a ninth of the runner's cap on the whole run, so a
// check reaching it is hung rather than slow; its two-minute hook allowance is
// what this project already relied on. The allowance is a hang cap and not a
// budget: the authoring guide's ask that a validator finish in seconds still
// governs what a check DRIVES.
export default defineEngineValidationConfig({
  // The workspace, not this directory, so a validator addresses the build by the
  // same relative paths the build itself uses — `src/game.ts`, which only
  // `harness.ts` and `constants.ts` reach, and the produced files under
  // `assets/`, which several of the produced-asset suites read straight off
  // disk. Derived from this file's own URL rather than from the working
  // directory, so the command above works from anywhere.
  root: new URL("..", import.meta.url).pathname,
});
