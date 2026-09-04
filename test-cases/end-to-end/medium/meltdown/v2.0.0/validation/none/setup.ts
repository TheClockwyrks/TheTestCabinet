// Meltdown — per-suite scaffolding for the browser the checks drive. CASE-PROVIDED.
//
// `globalSetup.ts` owns the one server and the one Chromium; each suite file runs
// in a worker of its own and connects to that browser to open a page. This gives
// every suite the matching teardown without asking a suite author to remember it:
// when the file's last test has run, the page and the connection go back.
//
// It is a `setupFiles` entry rather than something the harness does on its own
// because there is no other moment to do it in — a worker has no lifecycle hook
// of its own, and a harness cannot know it built the last one.
//
// WHY THIS ONE IS STILL THE CASE'S, where `assert.ts`, `chromium.ts`,
// `globalSetup.ts` and `vitest.config.ts` are now thin files over
// `@test-cabinet/case-harness`. The package's `registerCaseSetup` returns the
// pages of the PACKAGE's browser, and this project's `harness.ts` still holds its
// own; a call to it here would leave every page this project opened standing.
// This file goes back to the package with `harness.ts`, and not before.

import { afterAll } from "vitest";
import { closeWorkerBrowser } from "./harness";

afterAll(async () => {
  await closeWorkerBrowser();
});
