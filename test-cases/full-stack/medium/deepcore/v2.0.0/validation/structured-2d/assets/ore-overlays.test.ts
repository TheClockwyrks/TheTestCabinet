// assets/ore-overlays — every ore and gemstone has its own overlay.
//
// `specs/assets.md`: one overlay per ore and one per gemstone, at
// `assets/ore/<name>.png`, "named in lower case". `specs/mining.md` names the ten
// ores and the three gemstones, and `specs/instrumentation.md` fixes an ore's id
// as "its name in lower case", so the thirteen file names follow from the
// specification rather than from a list this check invented — `ORE_IDS` and
// `GEMSTONE_IDS` are that same set.
//
// Every one must be there and every pair must be a different drawing.
// `specs/overview.md` requires a player to tell the ten ores apart from one
// another and a gemstone from an ore at a glance, so two ores sharing a stamp is
// the failure this decides; whether the smears read as smears and the jewels as
// jewels is a reviewer's reading off the still, which poses a run of them side by
// side in one band's rock.
//
// THE STILL IS EVIDENCE ONLY. The verdict is read off the files, so the pose
// that puts the game beside them is guarded: a build whose debug surface
// cannot take the pose loses the picture and keeps the point, and no still is
// recorded over the un-posed frame.

import { afterEach, beforeEach, it } from "vitest";
import { MINERAL_SPRITES, PLAYABLE_COL_MIN } from "../constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  fillRow,
  layFloor,
  layOre,
  openScene,
  pinDrill,
  pinMiner,
  standOn,
  type Harness,
} from "../harness";
import { allDistinct, readPicture, type Picture } from "./produced";

/** Where the run of overlays in the still is posed. */
const ROW = 200;
const MINER_COL = PLAYABLE_COL_MIN + 3;

/** How many of the thirteen fit across the visible window beside the miner. */
const SHOWN = 6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("produces a distinct overlay for each of the thirteen minerals", async () => {
  const missing: string[] = [];
  const pictures: Picture[] = [];
  for (const ore of MINERAL_SPRITES) {
    const picture = await readPicture("ore", `${ore}.png`);
    if (picture === null) missing.push(`assets/ore/${ore}.png`);
    else pictures.push(picture);
  }

  try {
    openScene(h);
    pinDrill(h);
    layFloor(h, ROW);
    standOn(h, MINER_COL, ROW);
    pinMiner(h);
    fillRow(h, ROW - 1, MINER_COL + 1, MINER_COL + SHOWN, "rock");
    for (let at = 0; at < SHOWN; at += 1) {
      layOre(h, MINER_COL + 1 + at, ROW - 1, MINERAL_SPRITES[at]);
    }
    await h.advance(2);
    captureStill(h, "ores");
  } catch (error) {
    // Evidence only; the readings below carry the verdict.
    console.warn(
      `deepcore: could not pose the still for \`ores\`, so none is recorded: ${String(error)}`,
    );
  }

  assertEqual(missing.join(", "), "", "specs/assets.md");
  assertEqual(allDistinct(pictures), true, "specs/assets.md");
});
