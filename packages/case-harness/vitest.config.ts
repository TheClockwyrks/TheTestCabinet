import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

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
    minWorkers: 1,
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
