// assets/miner-mirrors — one drawing, mirrored, for the two facings.
//
// `specs/assets.md`: "Draw the miner facing one canonical direction and mirror it
// in the game to face the other, so the silhouette, the suit, the drill, and the
// jetpack are identical in both facings and across every cycle."
//
// So the miner is drawn at one position in one state facing each way and its box
// is read both times. The west reading is then FLIPPED left to right and compared
// against the east one: a build that mirrors one drawing matches; a build with two
// separately drawn facings does not, because two drawings of a suited figure agree
// nowhere near as closely as one and its own reflection.
//
// THE COMPARISON IS AGAINST A CONTROL, not against a threshold plucked out of the
// air. The same two readings are also compared UNFLIPPED, which is how far apart
// two pictures of the same miner facing opposite ways are, and the flipped
// comparison has to be far closer than that. Nothing here needs to know a palette
// or a sprite's exact placement inside the box.
//
// The reading is taken on a frame of no length between the two facings, so the
// cycle is held on the same drawn frame for both and what differs is the facing
// alone.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLessThan } from "../assert";
import { MINER_H, MINER_W, PLAYABLE_COL_MIN } from "../constants";
import {
  captureStill,
  createHarness,
  layFloor,
  openScene,
  pinDrill,
  standOn,
  worldToStage,
  type Harness,
} from "../harness";
import { sampleBox } from "./drawn";

const ROW = 200;
const COL = PLAYABLE_COL_MIN + 8;

/** How the box is sampled: a whole number of columns, so a flip is exact. */
const STEP = 4;

/** How much closer the flipped comparison must be than the unflipped one. */
const MARGIN = 0.5;

/** Flip a reading of `columns` wide left to right, row by row. */
function flip(reading: readonly number[], columns: number): number[] {
  const flipped: number[] = [];
  const rows = reading.length / 3 / columns;
  for (let row = 0; row < rows; row += 1) {
    for (let column = columns - 1; column >= 0; column -= 1) {
      const at = (row * columns + column) * 3;
      flipped.push(reading[at], reading[at + 1], reading[at + 2]);
    }
  }
  return flipped;
}

/** The mean absolute difference between two readings, per channel. */
function apart(a: readonly number[], b: readonly number[]): number {
  const count = Math.min(a.length, b.length);
  if (count === 0) return 0;
  let total = 0;
  for (let at = 0; at < count; at += 1) total += Math.abs(a[at] - b[at]);
  return total / count;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws the west-facing miner as the east-facing one reflected", async () => {
  await openScene(h);
  await pinDrill(h);
  await layFloor(h, ROW);
  await standOn(h, COL, ROW, "east");
  await h.advanceSeconds(0, 1);

  const snapshot = await h.snapshot();
  const at = worldToStage(snapshot, snapshot.miner.x, snapshot.miner.y);
  const box = { x: at.x, y: at.y, w: MINER_W, h: MINER_H };
  const columns = Math.ceil(MINER_W / STEP);

  const east = await sampleBox(h, box, STEP);
  await h.debug.setFacing("west");
  await h.advanceSeconds(0, 1);
  const west = await sampleBox(h, box, STEP);
  await captureStill(h, "mirror");

  const mirrored = apart(east, flip(west, columns));
  const straight = apart(east, west);

  assertEqual((await h.snapshot()).miner.facing, "west", "specs/character.md");
  assertLessThan(mirrored, straight * MARGIN, "specs/assets.md");
});
