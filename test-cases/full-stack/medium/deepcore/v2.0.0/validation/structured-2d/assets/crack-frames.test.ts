// assets/crack-frames — the drill-damage overlay is a produced progression.
//
// `specs/assets.md`: "at least `CRACK_FRAMES` (`4`) transparent frames running
// front to back from faint hairlines to a shattered, about-to-break face", under
// `assets/tiles/crack/`, numbered from `frame00.png`. Four parts, and each is a
// sentence of that:
//
//   * the frames are there, at that path and under that numbering;
//   * there are at least four of them;
//   * every one is a different drawing from every other, because they run FRONT TO
//     BACK — a progression that repeated a picture would show a cell's damage
//     standing still while its health fell;
//   * and each carries transparency, because the overlay is drawn OVER the rock
//     it cracks and an opaque frame would hide the band underneath it.
//
// Which frame is drawn at which damage is a different requirement and its own
// point; this one is about the frames existing and being a progression. The still
// is a row of cells posed at falling health, so a reviewer sees the progression on
// the rock it is drawn over.
//
// THE STILL IS EVIDENCE ONLY. The verdict is read off the files, so the pose
// that puts the game beside them is guarded: a build whose debug surface
// cannot take the pose loses the picture and keeps the point, and no still is
// recorded over the un-posed frame.

import { afterEach, beforeEach, it } from "vitest";
import { BAND_HEALTH, CRACK_FRAMES, PLAYABLE_COL_MIN } from "../constants";
import { assertEqual, assertGreaterThanOrEqual } from "../assert";
import {
  captureStill,
  createHarness,
  fillRow,
  layFloor,
  openScene,
  pinDrill,
  pinMiner,
  standOn,
  type Harness,
} from "../harness";
import { allDistinct, cycleFrames, readPictures } from "./produced";

/** A coreshell row, whose `BAND_HEALTH` (`16`) leaves room for a graded row. */
const ROW = 450;
const MINER_COL = PLAYABLE_COL_MIN + 4;

/** How many cells the still grades the damage across. */
const CELLS = 5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("produces at least four distinct transparent crack frames", async () => {
  const pictures = await readPictures(cycleFrames("tiles", "crack"));

  try {
    openScene(h);
    pinDrill(h);
    layFloor(h, ROW);
    standOn(h, MINER_COL, ROW);
    pinMiner(h);
    fillRow(h, ROW - 1, MINER_COL + 1, MINER_COL + CELLS, "rock");
    for (let step = 0; step < CELLS; step += 1) {
      h.debug.setTileHealth(
        MINER_COL + 1 + step,
        ROW - 1,
        (BAND_HEALTH.coreshell * (CELLS - step)) / (CELLS + 1),
      );
    }
    await h.advance(2);
    captureStill(h, "cracks");
  } catch (error) {
    // Evidence only; the readings below carry the verdict.
    console.warn(
      `deepcore: could not pose the still for \`cracks\`, so none is recorded: ${String(error)}`,
    );
  }

  assertGreaterThanOrEqual(
    pictures.length,
    CRACK_FRAMES,
    "assets/tiles/crack/frameNN.png (specs/assets.md)",
  );
  assertEqual(allDistinct(pictures), true, "specs/assets.md");
  assertEqual(
    pictures.every((picture) => picture.transparent && picture.drawn),
    true,
    "every crack frame is transparent and drawn (specs/assets.md)",
  );
});
