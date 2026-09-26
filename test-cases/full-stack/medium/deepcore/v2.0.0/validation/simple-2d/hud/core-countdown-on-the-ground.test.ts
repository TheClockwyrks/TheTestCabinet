// hud/core-countdown-on-the-ground — a dropped Sample counts down on its cell.
//
// `specs/ui.md`: a jettisoned Sample shows its countdown over its ground cell
// instead of over the miner, which is what lets a player back away and watch it
// from outside the blast. `specs/items.md` fixes the ground item: it sits on its
// cell with its countdown still visible, and its timer keeps running.
//
// So a Sample is placed on a cell through the surface, the miner stands well
// clear of it along the same floor, and the run of text that states the timer is
// found among the frame's own runs over the mine viewport. What is asserted is
// where it was drawn: nearer the Sample's cell than the miner. No radius is
// named, because `specs/ui.md` fixes none — "over its ground cell instead" is a
// comparison between two places, and that is what is read.
//
// The mine is drawn under a transform the game applies to `api.ctx` itself, so a
// run drawn beside the Sample names world coordinates at the call. `textSpans`
// carries the transform in force at each call, so what comes back is where the
// glyphs landed on the stage, which is the same space `worldToStage` maps into.

import { afterEach, beforeEach, it } from "vitest";
import { MINER_H, MINER_W, PLAYABLE_COL_MIN } from "../constants";
import { assertGreaterThan, assertLessThan } from "../assert";
import {
  captureStill,
  cellCenter,
  createHarness,
  layFloor,
  openScene,
  pinDrill,
  standOn,
  worldToStage,
  type Harness,
} from "../harness";
import { countdownRuns, worldText } from "./bar";

const ROW = 100;
const MINER_COL = PLAYABLE_COL_MIN + 5;

/** How far along the floor the Sample is dropped, in columns. */
const APART = 6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws the countdown at the dropped Sample rather than at the miner", async () => {
  openScene(h);
  layFloor(h, ROW);
  pinDrill(h);
  standOn(h, MINER_COL, ROW);
  // The cell above the floor, so the Sample rests on the ground the miner walks.
  h.debug.placeCoreSample(MINER_COL + APART, ROW - 1);
  await h.advance(2);

  const snapshot = h.snapshot();
  const runs = countdownRuns(await worldText(h), snapshot.coreTimer ?? 0);
  captureStill(h, "ground");

  const cell = cellCenter(MINER_COL + APART, ROW - 1);
  const atCell = worldToStage(snapshot, cell.x, cell.y);
  const atMiner = worldToStage(
    snapshot,
    snapshot.miner.x + MINER_W / 2,
    snapshot.miner.y + MINER_H / 2,
  );
  const nearest = (to: { x: number; y: number }): number =>
    Math.min(...runs.map((run) => Math.hypot(run.x - to.x, run.y - to.y)));

  assertGreaterThan(runs.length, 0, "specs/ui.md");
  assertLessThan(nearest(atCell), nearest(atMiner), "specs/ui.md");
});
