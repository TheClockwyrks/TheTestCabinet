import { createRequire } from "node:module";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { PLAYWRIGHT_ENV } from "./src/chromium";

// The package's own suite stands in for the runner, which names its Playwright
// package to a case's project (see `src/chromium.ts`): here that is the
// package's own pinned dev dependency. Set on this process, before `globalSetup`
// launches the browser, and inherited by every worker that connects to it.
process.env[PLAYWRIGHT_ENV] ??= dirname(
  createRequire(import.meta.url).resolve("playwright/package.json"),
);

/**
 * The package's OWN suite, which is not a case's.
 *
 * THE INCLUDE IS DELIBERATELY NARROW. This package is staged INSIDE a case's
 * validator project, whose vitest include globs every `.test.ts` under
 * `validation/` — so a `.test.ts` anywhere in `src/` would be collected by every
 * case's run, against a produced build rather than a fixture page. The package's
 * tests therefore live in `test/` (outside the `files` this package publishes)
 * and are named `*.spec.ts`, and this config refuses to look anywhere else.
 *
 * THE ROOT IS `test/`, WHICH IS THE POINT. It is laid out exactly as a staged
 * validator project is — a build output beside the suites that drive it — so the
 * scaffolding under test is exercised through the same shape it will meet in a
 * run: `globalSetup` probes this root for `dist/`, `build/` or `out/` and finds
 * `test/build/`, the fixture site, and serves it.
 */
export default defineConfig({
  root: fileURLToPath(new URL("./test", import.meta.url)),
  test: {
    include: ["**/*.spec.ts"],
    environment: "node",
    globalSetup: [
      fileURLToPath(new URL("./test/global-setup.ts", import.meta.url)),
    ],
    setupFiles: [fileURLToPath(new URL("./test/setup.ts", import.meta.url))],
    passWithNoTests: false,
    // Each suite file holds pages of the one shared browser while it runs.
    maxWorkers: 4,
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
