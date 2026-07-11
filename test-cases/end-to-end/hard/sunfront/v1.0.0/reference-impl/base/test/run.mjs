/**
 * Sunfront — headless test runner.
 *
 * The simulation core (`src/sim/`) is pure TypeScript with no THREE/DOM imports (its
 * runtime-package imports are type-only and erased), so we bundle the test entry with
 * esbuild (already a Vite dependency — no test runner to install) to a temp ESM module
 * and execute it on node. The test file sets `process.exitCode = 1` on any failed
 * assertion, which we surface as this process's exit code so `npm test` fails loudly.
 */

import { build } from "esbuild";
import { pathToFileURL } from "node:url";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const outfile = join(mkdtempSync(join(tmpdir(), "sunfront-sim-")), "sim.test.mjs");

await build({
  entryPoints: [join(here, "sim.test.ts")],
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node18",
  outfile,
  logLevel: "warning",
});

await import(pathToFileURL(outfile).href);

if (process.exitCode && process.exitCode !== 0) {
  console.error("\nSimulation invariants FAILED.");
}
