// Facet — the vitest project the CASE's validators run as, for `simple-2d`.
// CASE-PROVIDED.
//
// The whole of it is the shared `@clockwyrks/case-harness` package's factory,
// which fixes everything that makes a staged validator project one shape the
// runner can drive — the project's name, the suites it collects, the `node`
// environment, and the refusal to pass a run that collected nothing — and leaves
// this file the values that are genuinely Facet's.
//
//   npx vitest run                                       # the build's own tests
//   npx vitest run --config validation/vitest.config.ts  # the case's validators
//
// The two never mix: the build's config names `src/**/*.test.ts` and measures
// coverage over `src/`, so the tests a build wrote are counted and covered on
// their own and the verdict rests on the checks in this directory alone. A build
// cannot reach the verdict by writing a test, and a case's check cannot flatter
// the build's coverage.
//
// THERE IS NO `setupFiles` HERE ANY MORE, and no `setup.ts` beside this file.
// The browser faculties a headless engine run needs — the transport a produced
// file is fetched over, the image decoder, the audio context, the scratch canvas —
// used to be installed from a setup file so they stood before a test file's
// `import "../src/game"` was evaluated. They are installed at `harness.ts`'s own
// module scope now, which runs AFTER that import: nothing in a Facet build's
// module graph reads one of those globals at module scope (`src/scratch.ts` asks
// `typeof OffscreenCanvas` inside its factory, at the moment a burst is drawn),
// so the later moment is the same moment as far as the build is concerned.
//
// The factory is imported by its own specifier rather than through the package's
// barrel, because it is loaded by vite's own config path before the test runtime
// exists and it is the file whose failure mode is "the project would not load at
// all".
import { defineEngineValidationConfig } from "./case-harness/engine/vitest-config";

export default defineEngineValidationConfig({
  // The workspace, not this directory, so a validator resolves the build's
  // modules by the same relative paths the build itself uses. Derived from this
  // file's own URL rather than from the working directory, so the command above
  // works from anywhere and works both in the case's own `validation/simple-2d/`
  // and in the `validation/` the runner stages it to.
  root: new URL("..", import.meta.url).pathname,
  // AN ALLOWANCE A CORRECT BUILD CAN CROSS IS A DEFECT IN THE CHECK. Nothing
  // these checks measure comes off the wall clock — every one drives the build
  // frame by frame and asserts on what its own snapshot reports — so the only
  // thing a short allowance can decide is how busy the machine was, and these
  // suites run on a two-core host that is running nine other projects beside
  // them. Sixty seconds has been measured deciding exactly that elsewhere in the
  // repository, costing an unmodified reference four points at 66-76 s apiece
  // against quiet times of 6-14 s. Five minutes is set against that worst case,
  // and it is a ninth of the forty-five minutes the runner caps the whole suite
  // run at, so a file can only cross it on a host where the run was already lost.
  // A hung build is still bounded.
  testTimeout: 300_000,
  // Deliberately taking the factory's 120 s rather than the vitest default this
  // project used to sit on. An unset hook allowance is TEN SECONDS — the
  // tightest wall clock in the project and the one least related to anything the
  // build does, since this project's `beforeEach` builds an engine and awaits the
  // game's `initialize`, which is where every produced gem, cue and particle
  // system is fetched and decoded. Ten seconds of that on a loaded host is one
  // busy neighbour away from losing every point in a file, so it is stated.
  hookTimeout: 120_000,
});
