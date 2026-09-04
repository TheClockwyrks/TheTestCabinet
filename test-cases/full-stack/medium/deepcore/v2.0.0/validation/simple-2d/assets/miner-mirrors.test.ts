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
// air. The same two readings are also compared AS THEY STAND, which is how far
// apart two pictures of the same miner facing opposite ways are, and the flipped
// comparison has to be far closer than that. Nothing here needs to know a palette
// or a sprite's exact placement inside the box.
//
// BOTH READINGS ARE ON ONE DRAWN FRAME OF THE CYCLE. The facing is turned by a
// pose, and a pose reaches the game on the frame after it, so a frame of the
// cycle's own clock passes between the two readings. `ANIM_FPS` (`12`) holds each
// drawn frame for ten of this suite's frames, so the east reading is taken on the
// frame the cycle has just turned over on — found by watching the picture drawn
// over the miner change — and the west reading, one frame later, is on the same
// drawn frame with nine frames still to run.

import { afterEach, beforeEach, it } from "vitest";
import { MINER_W } from "../../src/constants";
import { assertEqual, assertLessThan } from "../assert";
import {
  TICK_HZ,
  captureStill,
  createHarness,
  type Harness,
} from "../harness";
import { frameImages, imageAt, sampleBox } from "./drawn";
import { minerBox, minerCentre, showMiner } from "./miner";

/** How the box is sampled: a whole number of columns, so a flip is exact. */
const STEP = 4;

/** How much closer the flipped comparison must be than the one as it stands. */
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

/**
 * Drive frames until the picture over `at` changes, so what follows opens on a
 * fresh drawn frame of the cycle.
 *
 * Bounded by a second of game time, which is longer than any cycle at `ANIM_FPS`:
 * a build drawing no produced sprite at all never changes picture, and it is held
 * to that by its own points rather than being waited on here.
 */
async function afterFrameChange(
  h: Harness,
  at: { x: number; y: number },
): Promise<void> {
  const opened = imageAt(await frameImages(h), at)?.key ?? null;
  for (let frame = 0; frame < TICK_HZ; frame += 1) {
    if ((imageAt(await frameImages(h), at)?.key ?? null) !== opened) return;
  }
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
  h = await createHarness({ assets: true });
});

afterEach(() => {
  h?.dispose();
});

it("draws the west-facing miner as the east-facing one reflected", async () => {
  await showMiner(h, "idle");
  await afterFrameChange(h, minerCentre(h));
  const box = minerBox(h);
  const columns = Math.ceil(MINER_W / STEP);

  const east = sampleBox(h, box, STEP);
  h.debug.setFacing("west");
  await h.advance(1);
  const west = sampleBox(h, box, STEP);
  captureStill(h, "mirror");

  const mirrored = apart(east, flip(west, columns));
  const straight = apart(east, west);

  assertEqual(h.snapshot().miner.facing, "west", "specs/character.md");
  assertLessThan(mirrored, straight * MARGIN, "specs/assets.md");
});
