// Wick — produce every sprite, sheet, icon, and the ground tile the game shows
// with the `draw` and `draw-sheet` tools (specs/assets.md "The sprites", "The
// weapon effects", "The icons").
//
// Production is a one-time step: the finished PNGs land under `assets/` and
// are committed, and neither `npm ci` nor `npm run build` runs this. Each
// sprite is composed as a pixel raster under `scripts/sprites/` and handed to
// the tool as the recorded operations that reproduce it; the tool renders the
// file the game ships. `ASSET-LAYOUT.md` maps every file this writes.
//
// Usage:  node scripts/gen-sprites.mjs [out-dir]
//   `draw` and `draw-sheet` must be on the PATH, or built under
//   `$CARGO_TARGET_DIR` (`/cargo-target/the-test-cabinet` by default).
//   `out-dir` defaults to `assets/` beside `scripts/`.

import console from "node:console";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { produceCommons } from "./sprites/commons.mjs";
import { produceEffects } from "./sprites/effects.mjs";
import { produceElites } from "./sprites/elites.mjs";
import { produceIcons } from "./sprites/icons.mjs";
import { openTools } from "./sprites/raster.mjs";
import {
  produceGems,
  produceGround,
  produceLamplighter,
  producePickups,
  producePuff,
} from "./sprites/world.mjs";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const out = path.resolve(process.argv[2] ?? path.join(ROOT, "assets"));

// The tools write their logs and previews where the config points, so every
// intermediate file goes to a scratch directory that is removed at the end,
// and only the finished PNGs land under `out`.
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "wick-sprites-"));
const started = Date.now();
try {
  const tools = openTools(scratch);
  const groups = [
    ["the lamplighter", produceLamplighter],
    ["the ground", produceGround],
    ["the gems", produceGems],
    ["the pickups", producePickups],
    ["the death puff", producePuff],
    ["the common enemies", produceCommons],
    ["the elites and the Dark", produceElites],
    ["the weapon effects", produceEffects],
    ["the icons", produceIcons],
  ];
  for (const [name, produce] of groups) {
    const before = tools.files;
    produce(tools, out);
    console.log(`${name}: ${tools.files - before} files`);
  }
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  console.log(
    `${tools.files} files from ${tools.operations} operations in ${seconds}s -> ${out}`,
  );
} finally {
  fs.rmSync(scratch, { recursive: true, force: true });
}
