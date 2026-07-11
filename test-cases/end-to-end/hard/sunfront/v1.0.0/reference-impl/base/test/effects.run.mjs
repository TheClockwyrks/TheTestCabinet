/**
 * Sunfront — headless runner for the effects + destruction drive (`effects.test.ts`).
 *
 * Mirrors `run.mjs`: the effects layer imports the (pure, GL-free) particle runtime, the
 * voxel posing math, and `three`'s CPU-side scene objects, so we bundle the test entry
 * with esbuild (already a Vite dependency — no extra test runner) to a temp ESM module and
 * execute it on node. The test sets `process.exitCode = 1` on any failed assertion, which
 * we surface as this process's exit code so it fails loudly.
 */

import { build } from "esbuild";
import { pathToFileURL } from "node:url";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const outfile = join(mkdtempSync(join(tmpdir(), "sunfront-fx-")), "effects.test.mjs");

await build({
  entryPoints: [join(here, "effects.test.ts")],
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node18",
  outfile,
  logLevel: "warning",
});

await import(pathToFileURL(outfile).href);

if (process.exitCode && process.exitCode !== 0) {
  console.error("\nEffects / destruction drive FAILED.");
}
