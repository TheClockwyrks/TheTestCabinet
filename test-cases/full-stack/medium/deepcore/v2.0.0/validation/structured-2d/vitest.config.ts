// Deepcore — the vitest project the CASE's validators run as, under the
// STRUCTURED 2D engine. CASE-PROVIDED.
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
// Everything but the root and the per-check allowance is the shared
// `@clockwyrks/case-harness` factory's, because everything else is what makes a
// staged validator project one shape the runner can drive: the project's name,
// the suites it collects, the `node` environment, and the refusal to pass a run
// that collected nothing.
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

export default defineEngineValidationConfig({
  // The workspace, not this directory, so the one reach a project makes at the
  // build addresses it by the same relative path the build itself uses —
  // `src/game.ts` — as do the produced files under `assets/`, which several of
  // the produced-asset suites read straight off disk. Derived from this file's
  // own URL rather than from the working directory, so the command above works
  // from anywhere.
  root: new URL("..", import.meta.url).pathname,
  // A Deepcore scenario is posed rather than played to, so most cost
  // milliseconds; the headroom is for the Core Sample's ninety-second timer and
  // the generation sweeps over several fresh mines at the Marathon size, both
  // driven off the clock rather than waited out. This is the figure the checks here were
  // measured against, and it is the one dial this project sets below the
  // factory's own default.
  testTimeout: 60_000,
});
