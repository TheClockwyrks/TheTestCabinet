// assets/material-sprites — the materials, the Core and the Sample are produced.
//
// `specs/assets.md`: `assets/materials/<name>.png` holds `resonite`, `cryenite`,
// `core`, and `core-sample`, and the sprites are "Resonite and Cryenite nodes, as
// raw crystal embedded in rock, distinct from both ore and gemstones; the glowing
// Core in its chamber; and the Core Sample". So all four must be there and all
// four must be different drawings.
//
// `specs/overview.md` is why the last part matters: a material node has to read as
// distinct from both ore and gemstones, and a player carrying a Core Sample has to
// see something other than the Core it was cut from. Whether they read as crystal
// and as a glowing core is a reviewer's reading off the still, which poses one node
// of each beside the miner.

import { afterEach, beforeEach, it } from "vitest";
import { MATERIALS, PLAYABLE_COL_MIN } from "../../src/constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  fillRow,
  layFloor,
  layMaterial,
  openScene,
  pinDrill,
  pinMiner,
  standOn,
  type Harness,
} from "../harness";
import { allDistinct, readPicture, type Picture } from "./produced";
import { MATERIAL_SPRITES } from "./spec";

/** Where the two nodes in the still are posed. */
const ROW = 200;
const MINER_COL = PLAYABLE_COL_MIN + 4;

let h: Harness;

beforeEach(async () => {
  h = await createHarness({ assets: true });
});

afterEach(() => {
  h?.dispose();
});

it("produces four distinct material sprites", async () => {
  const missing: string[] = [];
  const pictures: Picture[] = [];
  for (const name of MATERIAL_SPRITES) {
    const picture = await readPicture("materials", `${name}.png`);
    if (picture === null) missing.push(`assets/materials/${name}.png`);
    else pictures.push(picture);
  }

  openScene(h);
  pinDrill(h);
  layFloor(h, ROW);
  standOn(h, MINER_COL, ROW);
  pinMiner(h);
  fillRow(h, ROW - 1, MINER_COL + 1, MINER_COL + 4, "rock");
  for (const [at, material] of MATERIALS.entries()) {
    layMaterial(h, MINER_COL + 2 + at * 2, ROW - 1, material);
  }
  // And a Sample in the satchel, so the fourth sprite is on screen too.
  h.debug.setCoreCarried(true);
  await h.advance(2);
  captureStill(h, "materials");

  assertEqual(missing.join(", "), "", "specs/assets.md");
  assertEqual(allDistinct(pictures), true, "specs/assets.md");
});
