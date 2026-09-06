// Wireworm — the vitest project the CASE's validators run as. CASE-PROVIDED.
//
// The whole of it is the shared `@clockwyrks/case-harness` package's factory,
// which fixes everything that makes a staged validator project one shape the
// runner can drive — the project's name, the suites it collects, the `node`
// environment, and the refusal to pass a run that collected nothing — and
// leaves this file the two values that are genuinely Wireworm's.
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

export default defineEngineValidationConfig({
  // The workspace, not this directory, so a validator resolves the build's
  // modules by the same relative paths the build itself uses, and reads the
  // seeded sprite art off the workspace's own `assets/` tree. Derived from this
  // file's own URL rather than from the working directory, so the command above
  // works from anywhere.
  root: new URL("..", import.meta.url).pathname,
  // Every scenario is posed and stepped in process, so a suite costs
  // milliseconds; the ceiling is a failure cap for a build whose update stalls,
  // never a span a check waits out. Wireworm's own measurement, kept rather than
  // taking the factory's more generous default.
  testTimeout: 60_000,
  // The hook allowance is deliberately NOT set: vitest defaults an unset one to
  // TEN SECONDS, which is the tightest wall clock this project had and the one
  // least related to anything the build does — a `beforeEach` that builds an
  // engine and awaits the game's `initialize` can cross it on a loaded host
  // alone — and the factory's own default of two minutes is what replaces it.
});
