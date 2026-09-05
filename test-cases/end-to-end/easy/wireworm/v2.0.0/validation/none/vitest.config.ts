// Wireworm — the vitest project the CASE's validators run as. CASE-PROVIDED.
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
// Everything but the dial below is the shared validator harness's, because
// everything but the dial is what makes a staged validator project one shape the
// runner can drive: the project's name, the suites it collects, the scaffolding
// it loads, and the refusal to pass a run that collected nothing.
//
// THE ROOT IS THE WORKSPACE, NOT THIS DIRECTORY, so a validator addresses the
// build's output by the same relative path the build itself produced it at, and
// reads the seeded sprite art off the workspace's own `assets/` tree. It is
// computed HERE, from this file's own URL, rather than inside the package: the
// package is staged one directory deeper than this file, so anything derived from
// its own location would name the wrong tree.
//
// Imported from its own module rather than through the package's barrel, for the
// reason `globalSetup.ts` gives.
//
// THE ONE DIAL WIREWORM NAMES IS THE WORKER COUNT, and it is a ceiling on PAGES
// rather than on cores. Each suite file holds a page of the one shared browser
// while it runs, and this project is two hundred and twenty-four files of them; a
// page costs memory in a single browser process, on a host that is also running a
// model's build. Four is what this project's suites were measured at. Every other
// ceiling — the per-check allowance and the hook allowance — is left to the
// package, whose figures were set against the worst load these projects have been
// measured under rather than against a quiet box.

import { defineValidationConfig } from "./case-harness/vitest-config";

export default defineValidationConfig({
  root: new URL("..", import.meta.url).pathname,
  maxWorkers: 4,
});
