import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Drift guard for the vendored Foray replay assets.
//
// The UI bundles its own copy of the case's replay engine + sprite assets (see
// `renderer.ts` and `AdversarialReplaySection.tsx`) so every host draws a match
// identically without fetching the case bundle. That copy is a vendored snapshot
// of the foray bundle, and the two silently drifting is exactly how
// the interpolation rework shipped a teleporting player: the bundle's renderer +
// sheet changed, the UI's vendored copy did not.
//
// These assets are pure data, so we can enforce lockstep cheaply: each must be
// byte-identical to the bundle's. `renderer.ts` is a hand TS port of the bundle's
// `renderer.mjs` and cannot be byte-compared — but a renderer rework in practice
// always reshapes the sheet/atlas (new frames, anims, autotiles), so guarding the
// assets catches the drift that matters. Resync with:
//   node scripts/vendor-foray-assets.mjs

const here = dirname(fileURLToPath(import.meta.url));
// here = packages/ui/src/app/pages/runs/foray  ->  repo root is seven levels up.
const repoRoot = join(here, "..", "..", "..", "..", "..", "..", "..");

const BUNDLE = join(
  repoRoot,
  "test-cases/foray/v1.0.0/replay/assets",
);
const VENDORED = here + "/assets";

// Kept in sync with scripts/vendor-foray-assets.mjs (renderer.ts excluded — it is
// a manual port, not a copy).
const VENDORED_ASSETS = [
  "foray-core.wasm",
  "sheet.png",
  "sheet.json",
  "palette.json",
];

describe("vendored foray assets", () => {
  for (const name of VENDORED_ASSETS) {
    it(`${name} matches the case bundle byte-for-byte`, () => {
      const bundle = readFileSync(join(BUNDLE, name));
      const vendored = readFileSync(join(VENDORED, name));
      expect(
        vendored.equals(bundle),
        `packages/ui/.../foray/assets/${name} is stale vs the case bundle. ` +
          `Resync: node scripts/vendor-foray-assets.mjs`,
      ).toBe(true);
    });
  }
});
