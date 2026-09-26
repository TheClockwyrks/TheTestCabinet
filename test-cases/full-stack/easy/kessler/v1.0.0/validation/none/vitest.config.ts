// Kessler — the vitest project the CASE's validators run as. CASE-PROVIDED.
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
// The shape of the project — its name, the suites it collects, the `globalSetup`
// that stands up the one server and the one Chromium, the `setupFiles` that
// returns each worker's pages, and the refusal to pass a run that collected
// nothing — is the same for every engineless case, so it comes from
// `@clockwyrks/case-harness`. Kessler states the root, and nothing else: the
// package's measured allowances are wider than the ones this project had chosen
// for itself, and they are set against the worst load these projects have been
// run under rather than against a quiet box.
//
// The root is the WORKSPACE, not this directory, so a validator addresses the
// build's output by the same relative path the build itself produced it at. It is
// derived from this file's own URL rather than from the working directory, so the
// command above works from anywhere.
//
// Imported by its own specifier rather than through the package's barrel: this
// file is loaded by vite's own config path, before the test runtime exists.

import { defineValidationConfig } from "./case-harness/vitest-config";

export default defineValidationConfig({
  root: new URL("..", import.meta.url).pathname,
});
