// Orrery — the vitest project the CASE's validators run as, under the SIMPLE 2D
// engine. CASE-PROVIDED.
//
// The whole of it is the shared `@clockwyrks/case-harness` package's factory,
// which fixes everything that makes a staged validator project one shape the
// runner can drive — the project's name, the suites it collects, the `node`
// environment, the refusal to pass a run that collected nothing, and the hook
// allowance — and leaves this file the two values that are genuinely Orrery's.
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
// THE ENVIRONMENT IS `node`, and the factory fixes it. The engine takes every
// measurement from the `SurfaceMetrics` the harness supplies and draws through an
// `@napi-rs/canvas` canvas the harness owns, so these suites need no DOM. What a
// browser would otherwise have supplied — a `fetch` for the produced files, a
// `createImageBitmap` to decode one, and an `AudioContext` to bind a cue — the
// harness installs through the package's asset and audio hosts; see `harness.ts`.
//
// The factory is imported by its own specifier rather than through the package's
// barrel, because it is loaded by vite's own config path before the test runtime
// exists and it is the file whose failure mode is "the project would not load at
// all".
import { defineEngineValidationConfig } from "./case-harness/engine/vitest-config";

export default defineEngineValidationConfig({
  // THE ROOT IS THE WORKSPACE, NOT THIS DIRECTORY, so a validator resolves the
  // build's modules — `../src/game`, `../src/constants` — by the same relative
  // paths the build itself uses, and reads the produced files under `assets/`
  // where the build committed them. Derived from this file's own URL rather than
  // from the working directory, so the command above works from anywhere.
  root: new URL("..", import.meta.url).pathname,
  // Orrery's pointer operations take effect the moment they are called, so a
  // whole machine is placed without advancing the game. The ceiling is for the
  // checks that RUN a machine: a reference solution is allowed
  // `CAMPAIGN_REFERENCE_CYCLES` (600) cycles to complete, and a course walk
  // spends that budget once per challenge the build ships. It is a failure cap on
  // a build whose runs never end, not a figure a passing check approaches; the
  // factory's own default is higher, and the hook allowance it fixes is the 120 s
  // this project already set.
  testTimeout: 120_000,
});
