// assets/particle-on-drill — the debris plays at the bit while the miner cuts.
//
// `specs/assets.md`: `drill-debris.json` fires while "The miner is cutting a cell"
// and carries "A spray of chips and dust off the bit, tinted to the band". So the
// drawing near the cell being cut is counted twice over one posed world: with the
// drill held, and with it cutting. Everything else is identical — the same cell at
// the same part-cut health, the same miner in the same place, the same tiles
// behind it — so the difference is the effect.
//
// The cell is posed part cut for BOTH readings, so the crack overlay
// `specs/assets.md` draws over a damaged cell is in the control as much as in the
// measurement and cannot be mistaken for the debris.
//
// The miner's travel is held so it neither sinks into the cut nor walks out of the
// frame the readings are taken over, and the mine is cleared so no other effect
// can be playing anywhere near it.

import { afterEach, beforeEach, it } from "vitest";
import { BAND_HEALTH, PLAYABLE_COL_MIN, TILE } from "../constants";
import { assertEqual, assertGreaterThan } from "../assert";
import {
  ACTION_KEY,
  captureReplay,
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
import { peakNear } from "./effects";

/** A coreshell row, whose sixteen points of health leave room to cut for a while. */
const ROW = 450;
const COL = PLAYABLE_COL_MIN + 8;

/** Frames each reading is taken over. */
const CONTROL_FRAMES = 8;
const CUTTING_FRAMES = 24;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws more at the bit while cutting than while held", async () => {
  openScene(h);
  layFloor(h, ROW);
  standOn(h, COL, ROW);
  pinMiner(h);
  pinDrill(h);
  h.debug.setTileHealth(COL, ROW, BAND_HEALTH.coreshell / 2);
  await h.advance(2);

  const snapshot = h.snapshot();
  const centre = cellCenter(COL, ROW);
  const bit = worldToStage(snapshot, centre.x, centre.y);
  const where = (): { x: number; y: number } => bit;

  const control = await peakNear(h, CONTROL_FRAMES, TILE, where);

  const cutting = await captureReplay(h, "debris", async () => {
    h.debug.setMinerDrill(true);
    h.hold(ACTION_KEY.down);
    const peak = await peakNear(h, CUTTING_FRAMES, TILE, where);
    h.release(ACTION_KEY.down);
    return { peak, snapshot: h.snapshot() };
  });

  assertEqual(cutting.snapshot.miner.state, "drill-down", "specs/character.md");
  assertGreaterThan(cutting.peak, control, "specs/assets.md");
});
