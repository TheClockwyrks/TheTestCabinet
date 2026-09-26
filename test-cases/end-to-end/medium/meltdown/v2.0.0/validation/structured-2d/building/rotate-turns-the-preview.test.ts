// building/rotate-turns-the-preview — the held rotation moves through the four
// steps, and what is drawn on the floor follows it.
//
// specs/building.md, Rotating the preview: "While a preview is held, rotating
// advances the held rotation one step through 0, 1, 2, 3 and back to 0, turning
// its radiator faces as specs/towers.md states. Rotating changes only the held
// preview." And, from The preview follows the pointer: the held preview is drawn
// on the floor with "its radiator faces at the held rotation".
//
// TWO READINGS, BECAUSE THE RULE HAS TWO HALVES. The held rotation is read back
// at each of the four steps, and the type and footprint are read with it, so a
// build that moved the preview or dropped the type while turning it is caught.
// Then the FLOOR is read: an Arc's radiators are N and S (specs/towers.md), which
// rotation 1 turns into E and W, so what the preview draws at rotation 1 cannot
// be what it draws at rotation 0.
//
// HOW THE DRAWN HALF AVOIDS DEMANDING A LOOK. Nothing here says what a radiator
// face looks like — the specification fixes no colour, no mark and no thickness,
// and a build is free to draw them however it likes. What is compared is one
// frame against another over the same patch of floor: first two frames at the
// SAME rotation, which measures whatever the build's own drawing does between
// frames on its own, and then the frame after the turn. The turn has to move more
// pixels than a frame of the build's own drawing moves, which is true of any
// build that draws the faces at the held rotation and false of one that draws
// them the same way whatever it holds.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { TILE, tileLeft, tileTop } from "../constants";
import {
  captureStill,
  createHarness,
  sizeOf,
  startRun,
  type Harness,
} from "../harness";
import { heldPreview } from "./preview";

/** The type held. Its radiators are N and S, which rotation 1 turns to E and W. */
const HELD = "arc";
const SIZE = sizeOf(HELD);

/** The footprint held, on open floor well clear of the four openings. */
const COL = 10;
const ROW = 8;

/** The four steps, in the order specs/building.md states them. */
const STEPS = [0, 1, 2, 3];

/** Enough money that the preview reads valid throughout, so its tint holds. */
const PURSE = 1000;

/**
 * The patch of floor read: the footprint, plus a tile of margin on every side so
 * a build that draws its radiator marks just outside the block is read too.
 */
function patch(h: Harness): number[] {
  const x0 = tileLeft(COL) - TILE;
  const y0 = tileTop(ROW) - TILE;
  const side = (SIZE + 2) * TILE;
  const samples: number[] = [];
  for (let dy = 0; dy < side; dy += 1) {
    for (let dx = 0; dx < side; dx += 1) {
      const [r, g, b, a] = h.pixel(x0 + dx, y0 + dy);
      samples.push(r, g, b, a);
    }
  }
  return samples;
}

/** How many of the two patches' samples differ. */
function moved(before: readonly number[], after: readonly number[]): number {
  let count = 0;
  for (let i = 0; i < before.length; i += 1) {
    if (before[i] !== after[i]) count += 1;
  }
  return count;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("turns the held rotation and the preview drawn at it", async () => {
  startRun(h);
  h.debug.setMoney(PURSE);
  h.debug.setArmed(HELD);
  h.debug.setPreview(COL, ROW);

  for (const step of STEPS) {
    h.debug.setPreviewRotation(step);
    const build = heldPreview(h);
    assertEqual(build.rotation, step, `the held rotation set to ${step}`);
    assertEqual(build.type, HELD, `the type held at rotation ${step}`);
    assertEqual(build.col, COL, `the footprint's column at rotation ${step}`);
    assertEqual(build.row, ROW, `the footprint's row at rotation ${step}`);
  }

  h.debug.setPreviewRotation(0);
  await h.advance(1);
  const first = patch(h);
  await h.advance(1);
  const second = patch(h);
  const drift = moved(first, second);

  h.debug.setPreviewRotation(1);
  await h.advance(1);
  const turned = patch(h);
  captureStill(h, "rotated");

  assertGreaterThan(
    moved(second, turned),
    drift,
    `the floor under the preview once its radiator faces turn from N and S to ` +
      `E and W, against the ${drift} samples the same frame moves on its own`,
  );
});
