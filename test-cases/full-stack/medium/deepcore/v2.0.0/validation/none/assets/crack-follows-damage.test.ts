// assets/crack-follows-damage — the crack on a cell tracks that cell's damage.
//
// `specs/assets.md`: "The game picks the frame from a cell's damage fraction,
// `1 - health / BAND_HEALTH`, and draws it over every visible damaged cell, not
// only the one being cut." Two halves, and both are read off the drawn frame:
//
//   1. THE FRAME FOLLOWS THE DAMAGE. One cell is read at three healths — whole,
//      part cut, and nearly through — and each has to be drawn differently from
//      the others. The same cell is used throughout, so the rock variant under the
//      overlay is the same one and what changed is the overlay.
//   2. IT IS DRAWN ON CELLS THAT ARE NOT BEING CUT. Nothing here holds a drill
//      key: the damage is POSED with `setTileHealth`, and the miner stands a
//      column away with its drill held. A build that draws the crack only on its
//      current target draws nothing on either cell and fails.
//
// The healths are named as fractions of the band's own `BAND_HEALTH`, which is
// what `specs/world.md` gives the band and what the damage fraction is measured
// against, so nothing here assumes a health figure of its own.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan } from "../assert";
import { BAND_HEALTH, PLAYABLE_COL_MIN, TILE } from "../constants";
import {
  captureStill,
  cellCenter,
  createHarness,
  layFloor,
  openScene,
  pinDrill,
  pinMiner,
  standOn,
  worldToStage,
  type Harness,
} from "../harness";
import { boxChanged, sampleBox } from "./drawn";

/** A coreshell row, whose `BAND_HEALTH` (`16`) leaves room for three readings. */
const ROW = 450;
const MINER_COL = PLAYABLE_COL_MIN + 3;

/** The two cells read, a column apart and neither under the miner. */
const NEAR_COL = MINER_COL + 2;
const FAR_COL = MINER_COL + 4;

/** The healths the cells are posed at, as shares of the band's own. */
const SHARES = [1, 0.5, 0.125] as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws a different crack at each damage, on cells it is not cutting", async () => {
  await openScene(h);
  await pinDrill(h);
  await layFloor(h, ROW);
  await standOn(h, MINER_COL, ROW);
  await pinMiner(h);
  await h.debug.setTile(NEAR_COL, ROW, "rock");
  await h.debug.setTile(FAR_COL, ROW, "rock");
  await h.advanceSeconds(0, 1);

  const snapshot = await h.snapshot();
  const boxOver = (
    col: number,
  ): { x: number; y: number; w: number; h: number } => {
    const centre = cellCenter(col, ROW);
    const at = worldToStage(snapshot, centre.x, centre.y);
    return {
      x: at.x - TILE / 3,
      y: at.y - TILE / 3,
      w: TILE / 1.5,
      h: TILE / 1.5,
    };
  };

  const full = BAND_HEALTH.coreshell;
  const readings: number[][] = [];
  for (const share of SHARES) {
    await h.debug.setTileHealth(NEAR_COL, ROW, full * share);
    await h.debug.setTileHealth(FAR_COL, ROW, full * share);
    await h.advanceSeconds(0, 1);
    readings.push(await sampleBox(h, boxOver(NEAR_COL)));
  }

  // And the far cell, which nothing has ever aimed at, at its extremes.
  await h.debug.setTileHealth(FAR_COL, ROW, full);
  await h.advanceSeconds(0, 1);
  const farWhole = await sampleBox(h, boxOver(FAR_COL));
  await h.debug.setTileHealth(FAR_COL, ROW, full * SHARES[2]);
  await h.advanceSeconds(0, 1);
  const farCut = await sampleBox(h, boxOver(FAR_COL));
  await captureStill(h, "damage");

  assertGreaterThan(boxChanged(readings[0], readings[1]), 0, "specs/assets.md");
  assertGreaterThan(boxChanged(readings[1], readings[2]), 0, "specs/assets.md");
  assertGreaterThan(boxChanged(readings[0], readings[2]), 0, "specs/assets.md");
  assertGreaterThan(boxChanged(farWhole, farCut), 0, "specs/assets.md");
});
