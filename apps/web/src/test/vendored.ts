// Where the drift guards over the vendored replay assets read from.
//
// `@clockwyrks/ui` ships its own copies of the Foray and Lattice cases' replay
// assets (the sprite sheets and atlases, the Foray engine, the Lattice reference
// scenarios), so every host draws a run without fetching the case bundle. The
// copies are vendored from the case versions in the test-suites checkout by
// scripts/vendor-foray-assets.mjs and scripts/vendor-lattice-assets.mjs, which
// write them into the ui-common checkout. The console is what holds the
// test-suites data edge, so the guards live here: they read the copies out of
// the package the console resolves, as it ships them, and the bundles out of
// the test-suites checkout beside it.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** The directory `@clockwyrks/ui` resolves to from this app. */
const ui = path.dirname(
  createRequire(import.meta.url).resolve("@clockwyrks/ui/package.json"),
);

/** This repository's root: `apps/web/src/test` is four levels below it. */
const repoRoot = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);

/**
 * The directory of the shipped copy of a page's vendored assets, as the built
 * package carries it (`dist/` mirrors `src/`).
 *
 * @param page The run page the assets belong to, `foray` or `lattice`.
 */
export function vendoredAssets(page: "foray" | "lattice"): string {
  return path.join(ui, "dist/app/pages/runs", page, "assets");
}

/**
 * A directory of a committed case version in the test-suites checkout.
 *
 * @param version The version's path under `test-suites/test-cases/`.
 */
export function caseVersion(version: string): string {
  return path.join(repoRoot, "test-suites/test-cases", version);
}

/**
 * Whether a shipped copy holds what the bundle's file holds.
 *
 * A binary asset ships byte for byte. A JSON one is compared by its value: the
 * package's TypeScript build re-emits every JSON module its sources import with
 * its own indentation, so the shipped bytes are the bundle's data laid out anew.
 *
 * @param shipped The shipped copy's path.
 * @param bundled The case bundle's file.
 */
export function sameAsset(shipped: string, bundled: string): boolean {
  const copy = readFileSync(shipped);
  const original = readFileSync(bundled);
  return shipped.endsWith(".json")
    ? JSON.stringify(JSON.parse(copy.toString("utf8"))) ===
        JSON.stringify(JSON.parse(original.toString("utf8")))
    : copy.equals(original);
}
