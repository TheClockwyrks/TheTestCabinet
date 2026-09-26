// Facet — the vitest project the CASE's validators run as. CASE-PROVIDED.
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
// coverage over `src/`, so a build cannot reach the verdict by writing a test
// and a case's check cannot flatter the build's coverage.
//
// THERE IS NO `setupFiles` HERE ANY MORE, and that is the change worth naming.
// An engine project used to need one, because the browser faculties a headless
// run stands in for — `fetch` over the build's own tree, `createImageBitmap`,
// an `AudioContext` that decodes and never sounds, a canvas the platform can
// make — were installed by a setup file so they were in place before a suite's
// `../src/game` was evaluated. They are now installed at `harness.ts`'s module
// scope, from the package's asset and audio hosts, which is the arrangement
// every migrated engine project in the tree uses. Nothing in this build's module
// graph reads one of those globals while it is being evaluated, so the moment of
// installation is not observable to it.
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
  // works from anywhere — and works both in the case's own
  // `validation/structured-2d/` and in the `validation/` the runner stages it to.
  root: new URL("..", import.meta.url).pathname,
  // AN ALLOWANCE A CORRECT BUILD CAN CROSS IS A DEFECT IN THE CHECK. Nothing
  // these checks measure comes off the wall clock — every one drives the build
  // frame by frame and asserts on what its own snapshot reports — so the only
  // thing a short allowance can decide is how busy the machine was, and these
  // suites run on a two-core host that is running nine other projects beside
  // them. Sixty seconds has been measured deciding exactly that elsewhere in
  // the repository, costing an unmodified reference four points at 66-76 s
  // apiece against quiet times of 6-14 s. Five minutes is set against that
  // worst case, and it is a ninth of the forty-five minutes the runner caps
  // the whole suite run at, so a file can only cross it on a host where the
  // run was already lost. A hung build is still bounded.
  testTimeout: 300_000,
  // The hook allowance this project never set, and should have. Vitest defaults
  // an unset one to TEN SECONDS, which was the tightest wall clock here and the
  // one least related to anything the build does — a `beforeEach` that builds an
  // engine and awaits the game's `initialize`, which is where every produced
  // sprite, sheet, system and cue of this case is loaded and decoded off disk,
  // can cross ten seconds on a loaded host alone. Taking the factory's 120 s is
  // a deliberate improvement over the silence that stood here, for the same
  // reason the test allowance above is set at all.
  hookTimeout: 120_000,
});
