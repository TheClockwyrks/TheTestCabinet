// Wireworm — the vitest project the CASE's validators run as. CASE-PROVIDED.
//
// The whole of it is the shared `@clockwyrks/case-harness` package's factory,
// which fixes everything that makes a staged validator project one shape the
// runner can drive — the project's name, the suites it collects, the `node`
// environment, and the refusal to pass a run that collected nothing — and
// leaves this file the one value that is genuinely Wireworm's: its root.
//
//   npx vitest run                                       # the build's own tests
//   npx vitest run --config validation/vitest.config.ts  # the case's validators
//
// The two projects never mix: the build's config names `src/**/*.test.ts` and
// measures coverage over `src/`, so the tests a build wrote are counted and
// covered on their own, and the verdict rests on the checks in this directory
// alone. A build cannot reach the verdict by writing a test, and a case's check
// cannot flatter the build's coverage.
//
// The factory is imported by its own specifier rather than through the package's
// barrel, because it is loaded by vite's own config path before the test runtime
// exists and it is the file whose failure mode is "the project would not load at
// all".
import { defineEngineValidationConfig } from "./case-harness/engine/vitest-config";

// NO DIALS. The minute this project used to name for `testTimeout` was sized
// against a healthy machine and the reference's own drawing, under a comment
// that "a suite costs milliseconds". Neither holds. The ten-second sweep of
// active play `instrumentation/worm-entry-gate` drives is some fourteen hundred
// frames, every one rendered through the engine onto the recording canvas,
// and a produced build measured 8.2 s on it with the whole project in flight —
// one busy host away from a sixty-second cap. The specification fixes nothing
// about how a build draws the board, so a build that blits the grid tile by
// tile costs that canvas an order of magnitude more per frame than one that
// fills it, and it is a conforming build: every check here reads the snapshot
// and the picture and never the wall clock, so the only thing a low ceiling
// can take from such a build is a point it did nothing to lose. The factory's
// five minutes are the figure measured against a host running nine of these
// projects at once, a ninth of the runner's cap on the whole run, so a check
// reaching it is hung rather than slow; its two-minute hook allowance replaces
// vitest's ten-second default, the tightest wall clock a validator project has
// and the one least related to anything the build does. The allowance is a
// hang cap and not a budget: the authoring guide's ask that a validator finish
// in seconds still governs what a check DRIVES.
export default defineEngineValidationConfig({
  // The workspace, not this directory, so a validator resolves the build's
  // modules by the same relative paths the build itself uses, and reads the
  // seeded sprite art off the workspace's own `assets/` tree. Derived from this
  // file's own URL rather than from the working directory, so the command above
  // works from anywhere.
  root: new URL("..", import.meta.url).pathname,
});
