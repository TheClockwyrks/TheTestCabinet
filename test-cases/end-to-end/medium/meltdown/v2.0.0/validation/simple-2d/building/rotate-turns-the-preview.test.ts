// building/rotate-turns-the-preview — the held rotation moves through the four
// steps, and what the preview draws on the floor follows it.
//
// specs/building.md, Rotating the preview: "While a preview is held, rotating
// advances the held rotation one step through 0, 1, 2, 3 and back to 0, turning
// its radiator faces as specs/towers.md states. Rotating changes only the held
// preview." And, from The preview follows the pointer, the held preview is drawn
// on the floor with "its radiator faces at the held rotation".
//
// TWO READINGS, BECAUSE THE RULE HAS TWO HALVES. The held rotation is read back at
// each of the four steps, and the type and the footprint are read with it, so a
// build that moved the preview or dropped the type while turning it is caught —
// "rotating changes only the held preview". Then the FLOOR is read.
//
// WHY ROTATION 0 AGAINST ROTATION 1 AND NOT 0 AGAINST 2. An Arc's radiators are
// local N and S (specs/towers.md), and a rotation turns a local face
// `N -> E -> S -> W`, so rotation 2 turns local N into world S and local S into
// world N — the same PAIR of world faces. Rotation 0 and rotation 2 are therefore
// indistinguishable on this tower by design, and only the quarter turn moves
// anything. `building/placed-at-the-held-rotation` is where the full four-way
// mapping is decided, on a tower whose faces are asymmetric.
//
// HOW THE DRAWN HALF AVOIDS DEMANDING A LOOK. Nothing in the specification says
// what a radiator face looks like — no colour, no mark, no thickness — and a build
// is free to draw one however it likes. So what is compared is the frame's own
// picture against itself: the pixels over the patch of floor the footprint
// occupies, read straight off the canvas the build drew into, which is what makes
// every conformant shape visible — a build that turns its geometry, and a build
// that draws four fixed bars and changes which of them is painted as a radiator.
// FIRST TWO FRAMES AT THE SAME ROTATION, which measures whatever the build's own
// drawing does between frames on its own, and then the frame after the turn. The
// turn has to move more of the patch than that, which is true of any build that
// draws the faces at the held rotation and false of one that draws them the same
// way whatever it holds.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { TILE, tileLeft, tileTop } from "../constants";
import { sizeOf } from "../geometry";
import {
  captureStill,
  createHarness,
  startRun,
  type Harness,
} from "../harness";
import { heldPreview } from "./preview";
import { FREE_SITE } from "./sites";

/** The type held. Its radiators are local N and S, which one step turns to E and W. */
const HELD = "arc";
const SIZE = sizeOf(HELD);

/** A quiet anchor: clear of every opening and of both corridors. */
const AT = FREE_SITE;

/** The four steps, in the order specs/building.md states them. */
const STEPS = [0, 1, 2, 3];

/** Enough money that the preview reads valid throughout, so its tint holds. */
const PURSE = 1000;

/**
 * The patch of floor read: the footprint, plus a tile of margin on every side, so
 * a build that draws its face marks just outside the block is read too.
 */
const PATCH = {
  x0: tileLeft(AT.col) - TILE,
  y0: tileTop(AT.row) - TILE,
  x1: tileLeft(AT.col) + (SIZE + 1) * TILE,
  y1: tileTop(AT.row) + (SIZE + 1) * TILE,
};

/**
 * How far apart two samples of one pixel must be to count as a different pixel,
 * per channel.
 *
 * A rasterizer draws the same pixels frame to frame, so a conformant build repeats a
 * pixel exactly; this band exists so a build that dithers or animates a highlight
 * by a shade is not counted as having turned anything. For scale, the smallest
 * change this reading has to see is a face mark appearing where the floor was, and
 * the specification requires a valid preview and an invalid one to be drawn apart
 * at all (specs/hud.md), so nothing a build paints its faces in is within four
 * shades of the tile beneath.
 */
const CHANNEL_TOLERANCE = 4;

/** The pixels of {@link PATCH} as the last frame left them. */
function patchPixels(h: Harness): Uint8ClampedArray {
  const from = h.device(PATCH.x0, PATCH.y0);
  const to = h.device(PATCH.x1, PATCH.y1);
  const { data } = h.ctx.getImageData(
    from.x,
    from.y,
    to.x - from.x,
    to.y - from.y,
  );
  return new Uint8ClampedArray(data);
}

/** Run one frame and hand back what it left over the patch. */
async function drawPatch(h: Harness): Promise<Uint8ClampedArray> {
  await h.advance(1);
  return patchPixels(h);
}

/** How many pixels of the patch the two frames do not share. */
function moved(before: Uint8ClampedArray, after: Uint8ClampedArray): number {
  let count = 0;
  for (let i = 0; i < before.length; i += 4) {
    for (let channel = 0; channel < 4; channel += 1) {
      if (
        Math.abs(before[i + channel] - after[i + channel]) > CHANNEL_TOLERANCE
      ) {
        count += 1;
        break;
      }
    }
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
  h.debug.setPreview(AT.col, AT.row);

  for (const step of STEPS) {
    h.debug.setPreviewRotation(step);
    const build = heldPreview(h);
    assertEqual(build.rotation, step, `the held rotation set to ${step}`);
    assertEqual(build.type, HELD, `the type held at rotation ${step}`);
    assertEqual(
      build.col,
      AT.col,
      `the footprint's column at rotation ${step}`,
    );
    assertEqual(build.row, AT.row, `the footprint's row at rotation ${step}`);
  }

  h.debug.setPreviewRotation(0);
  const first = await drawPatch(h);
  const second = await drawPatch(h);
  const drift = moved(first, second);

  h.debug.setPreviewRotation(1);
  const turned = await drawPatch(h);
  captureStill(h, "rotated");

  assertGreaterThan(
    moved(second, turned),
    drift,
    "the pixels the preview moved over its own patch of floor once its radiator " +
      `faces turn from world N and S to world E and W, against the ${drift} the ` +
      "same frame moves on its own",
  );
});
