import path from "node:path";
import { assert, describe, it } from "vitest";

import { caseVersion, sameAsset, vendoredAssets } from "./test/vendored";

// Drift guard for the vendored Foray replay assets.
//
// The UI bundles its own copy of the case's replay engine + sprite assets (see
// `renderer.ts` and `AdversarialReplaySection.tsx` in `@clockwyrks/ui`) so every
// host draws a match identically without fetching the case bundle. That copy is a vendored snapshot
// of the foray bundle, and the two silently drifting is exactly how
// the interpolation rework shipped a teleporting player: the bundle's renderer +
// sheet changed, the UI's vendored copy did not.
//
// These assets are pure data, so we can enforce lockstep cheaply: each must be
// identical to the bundle's (a JSON one in value; see ./test/vendored.ts). `renderer.ts` is a hand TS port of the bundle's
// `renderer.mjs` and cannot be byte-compared — but a renderer rework in practice
// always reshapes the sheet/atlas (new frames, anims, autotiles), so guarding the
// assets catches the drift that matters. Resync with:
//   node scripts/vendor-foray-assets.mjs

// The foray version lives in the test-suites checkout; the copies are the ones
// `@clockwyrks/ui` ships (see ./test/vendored.ts).
const BUNDLE = path.join(
  caseVersion("adversarial/easy/foray/v1.0.0"),
  "replay/assets",
);
const VENDORED = vendoredAssets("foray");

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
    it(`${name} matches the case bundle`, () => {
      assert(
        sameAsset(path.join(VENDORED, name), path.join(BUNDLE, name)),
        `@clockwyrks/ui's foray/assets/${name} is stale vs the case bundle. ` +
          `Resync: node scripts/vendor-foray-assets.mjs`,
      );
    });
  }
});
