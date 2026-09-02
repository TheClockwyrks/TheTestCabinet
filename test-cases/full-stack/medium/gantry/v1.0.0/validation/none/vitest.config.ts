// Gantry — the vitest project the CASE's validators run as. CASE-PROVIDED.
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
// runner can drive: the project's name, the suites it collects
// (`validation/**/*.test.ts`), the scaffolding it loads, the coverage it does not
// measure, and the refusal to pass a run that collected nothing
// (`passWithNoTests: false` — a missing validator is a broken suite, not a
// passing one).
//
// THE ROOT IS THE WORKSPACE, NOT THIS DIRECTORY, so a validator addresses the
// build's output by the same relative path the build itself produced it at, and
// `globalSetup` finds `dist/` where `vite build` wrote it. It is computed HERE,
// from this file's own URL, rather than inside the package: the package is staged
// one directory deeper than this file, so anything derived from its own location
// would name the wrong tree. In the staged project this file is
// `<workspace>/validation/vitest.config.ts`, so `..` is the workspace.
//
// Imported from its own module rather than through the package's barrel, for the
// reason `globalSetup.ts` gives.

import { defineValidationConfig } from "./case-harness/vitest-config";

export default defineValidationConfig({
  root: new URL("..", import.meta.url).pathname,
  // A Gantry scenario is real structural simulation: a reference tape is a
  // thousand ticks of two linear solves per tick, each of them a crossing into
  // the page, and a crane is posed one edit at a time before any of it starts.
  // Generous against a healthy build, and still bounds a hung one.
  testTimeout: 180_000,
  hookTimeout: 60_000,
});
