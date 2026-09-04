// @test-cabinet/case-harness — the shared engineless (`none`) validation harness.
//
// WHAT THIS PACKAGE IS. Under an engine, a case's validators import the engine
// and read the game in process. Under NO engine there is nothing to import: the
// run seeds no `src/` at all, so the build wrote its own frame loop, its own
// canvas fit, its own keyboard, its own audio and its own debug surface, and the
// only place all of that exists is a page that has loaded the bundle. Every
// engineless case therefore needs the same machinery — serve the build, drive it
// in a real browser, bracket each driven frame around one step of the build's
// surface, record what it drew, and read pixels and draw calls back out. That
// machinery is here, once, rather than copied into each case.
//
// THIS IS THE ONE FILE A CASE IMPORTS. It re-exports every module of the package,
// so a case's `harness.ts` and its `assert.ts` name one specifier and everything
// arrives through it. Two modules are deliberately NOT re-exported here, and both
// for the same reason:
//
//   - `./vitest-config` (`defineValidationConfig`)
//   - `./global-setup`  (`makeGlobalSetup`)
//
// They are loaded by vite's own config path, before the test runtime exists, and
// they are the two files whose failure mode is "the project would not load at
// all". Reaching them through this barrel would drag the whole package — the
// harness, the media writer, playwright's types, `vitest/config` and the vite
// graph behind it — into every worker that imports anything at all, for two
// functions no suite ever calls. So a case's `vitest.config.ts` and its
// `globalSetup.ts` import those two specifiers DIRECTLY:
//
// ```ts
// import { defineValidationConfig } from "./case-harness/vitest-config";
// import { makeGlobalSetup } from "./case-harness/global-setup";
// ```
//
// WHERE THIS FILE SITS AT RUN TIME. The package is staged into a case's validator
// project as a sibling of the case's own `harness.ts`, so the same import line
// resolves both in the checkout (`validation/<engine>/case-harness/`) and in the
// staged tree (`validation/case-harness/`). Nothing here may derive a path from
// its own `import.meta.url` and expect it to name the case's project: the case's
// root arrives as `CaseConfig.projectRoot`, and the build's root is read off
// vitest's own `TestProject`.

/* The case-facing factory: one call, everything below bound to one case. */
export * from "./kit";

/* What a case says about itself, and the constants it is measured against. */
export * from "./config";

/* The runner contract: the assertions every check states its verdict through. */
export * from "./assert";

/* The browser, the page, and the driven frame. */
export * from "./browser";
export * from "./chromium";
export * from "./clock";
export * from "./harness";
export * from "./setup";
export * from "./surface";

/* The readings a check makes off a frame. */
export * from "./audio";
export * from "./color";
export * from "./draw-calls";
export * from "./matrix";
export * from "./pixels";
export * from "./point";
export * from "./pointer";
export * from "./touch";
export * from "./text";
export * from "./viewport";

/* The evidence a review point is decided on. */
export * from "./media";
export * from "./replay/format";
export * from "./replay/retable";
