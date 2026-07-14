// Re-vendor the Foray replay assets the UI bundles from their single source of
// truth, the foray case's replay bundle.
//
// The shared gallery app (`@test-cabinet/ui`) draws match replays on a <canvas>
// with its own copy of the renderer + sprite assets, so the public site, web
// console and desktop app all play a match identically without each fetching the
// case bundle. That copy must stay in lockstep with the case's bundle, or the UI
// silently renders with a stale engine/atlas (e.g. the interpolation rework that
// teleported agents because only the bundle was updated). This script copies the
// four binary/JSON assets the UI vendors — it does NOT touch `renderer.ts`, which
// is a hand TS port of the bundle's `renderer.mjs` and must be re-ported by hand
// when the bundle's renderer logic changes.
//
// `renderer.vendor.test.ts` asserts the vendored copies are byte-identical to the
// bundle, so a forgotten resync fails CI. Run this to fix such a failure:
//   node scripts/vendor-foray-assets.mjs

import { copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

const SRC = join(
  repoRoot,
  "test-cases/adversarial/hard/foray/v1.0.0/replay/assets",
);
const DST = join(repoRoot, "packages/ui/src/app/pages/runs/foray/assets");

// The assets the UI vendors verbatim from the bundle (see the import block in
// AdversarialReplaySection.tsx). `renderer.ts` is deliberately excluded.
export const VENDORED_ASSETS = [
  "foray-core.wasm",
  "sheet.png",
  "sheet.json",
  "palette.json",
];

for (const name of VENDORED_ASSETS) {
  copyFileSync(join(SRC, name), join(DST, name));
  console.log(`vendored ${name}`);
}
