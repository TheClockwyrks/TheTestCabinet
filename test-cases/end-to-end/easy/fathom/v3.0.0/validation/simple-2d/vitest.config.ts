// Fathom — the vitest project the CASE's validators run as. CASE-PROVIDED.
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
// Everything but the dials below is the shared validator harness's, because
// everything but the dials is what makes a staged validator project one shape the
// runner can drive: the project's name, the suites it collects, the `node`
// environment every engine measures through, and the refusal to pass a run that
// collected nothing.
//
// THE ROOT IS THE WORKSPACE, NOT THIS DIRECTORY, so a validator resolves the
// build's modules by the same relative paths the build itself uses. It is
// computed HERE, from this file's own URL, rather than inside the package: the
// package is staged one directory deeper than this file, so anything derived from
// its own location would name the wrong tree.
//
// Imported from its own module rather than through the package's barrel: it is
// loaded by vite's own config path, before the test runtime exists, and reaching
// it through the barrel would drag the kit, `@napi-rs/canvas` and the whole vite
// graph into every worker for one function no suite ever calls.
//
// WHAT ONE FULL RUN COSTS, MEASURED. Against `references/simple-2d/base`, on an
// idle developer machine with cores to spare, the whole of a base run's
// checklist — 158 suites, every one of the points a base dive is rated on —
// finished in under half a minute of wall clock, and the kindle checklist, four
// suites longer, in about the same. An engine-backed suite runs in process
// rather than over a browser, which is why it costs a fraction of what the
// engineless project does. A two-core host is the machine the fifteen-minute
// budget is stated against and is several times slower than that, and a run's
// build is competing with the suites for those two cores, so the honest reading
// of the figure is margin rather than a prediction.

import { defineEngineValidationConfig } from "./case-harness/engine/vitest-config";

export default defineEngineValidationConfig({
  root: new URL("..", import.meta.url).pathname,
  // ONE DIAL, AND IT IS THE HOOK'S. The package's five minutes for a check is
  // already what this case measured for itself: the longest checks here are
  // minutes of GAME time — `gloamfin/wander-speed` reads a patrol a minute apart
  // because specs/predators/gloamfin.md states the claim in that unit, which is
  // 7,200 ticks of real simulation — and a march like that is run off camera
  // through the harness's `skip`, which spends it several ticks a frame, so the
  // minute costs a fraction of a second of wall clock. The ceiling exists to stop
  // a build that never terminates, not to time the host.
  //
  // The HOOK is raised from the package's two minutes to the same five, because
  // `beforeEach` here constructs the engine, loads every seeded sheet and runs
  // the build's `initialize` — real work, and work that competes with whatever
  // else the host is running. A hook budget sized for a quiet machine fails a
  // perfectly good build as "hook timed out", which says nothing about the build
  // at all.
  hookTimeout: 300_000,
});
