// Cascade — the vitest project the CASE's validators run as. CASE-PROVIDED.
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
// Everything but the two dials below is the shared validator harness's, because
// everything but the dials is what makes a staged validator project one shape the
// runner can drive: the project's name, the suites it collects, the scaffolding
// it loads, and the refusal to pass a run that collected nothing.
//
// THE ROOT IS THE WORKSPACE, NOT THIS DIRECTORY, so a validator addresses the
// build's output by the same relative path the build itself produced it at. It is
// computed HERE, from this file's own URL, rather than inside the package: the
// package is staged one directory deeper than this file, so anything derived from
// its own location would name the wrong tree.
//
// Imported from its own module rather than through the package's barrel, for the
// reason `globalSetup.ts` gives.
//
// WHAT THE TWO DIALS BOUND, AND WHAT THEY MUST NOT DECIDE. Every suite here is
// deterministic: it poses a board, drives a counted number of frames through the
// build's own `advance`, and reads what they left. Not one assertion in the
// project reads a wall clock. So what a timeout can measure is how much of this
// machine the suite was given — and a figure a correct build can cross on a busy
// host is not a bound on the build at all, it is a second verdict on the host,
// and it fails the wrong thing.
//
// They are set from the longest scenario the checklist asks for, which is why
// they are raised above the package's own. The victory cascade runs for a little
// over twelve seconds of game time with up to fifty-two cards in the air, and
// every frame of it is a full update and render inside a real browser; the waits
// are taken at `RUNOUT_HZ` so the cost is a quarter of what it was, and the whole
// of one still runs to tens of seconds on an idle host. Ten minutes is that with
// an order of magnitude of room, which is what it takes to survive a host running
// many times its own number of cores. It remains a ceiling and not a target: a
// suite that hangs costs this and no more, and every suite here finishes in
// seconds when the machine is its own. The hook allowance matches, because a hook
// opens a page, loads the build, waits for its surface and resets it — half a
// dozen crossings and a page load, every one of them the host's cost rather than
// the build's — and a hook that expires reports no verdict at all.

import { defineValidationConfig } from "./case-harness/vitest-config";

export default defineValidationConfig({
  root: new URL("..", import.meta.url).pathname,
  testTimeout: 600_000,
  hookTimeout: 600_000,
});
