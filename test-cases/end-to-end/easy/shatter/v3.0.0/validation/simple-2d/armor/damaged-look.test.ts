// rocks/damaged-look — a damaged rock reads as damaged.
//
// `specs/rocks.md`: "A rock is drawn progressively more damaged as its health
// falls, so a player can judge how many hits it has left. A rock at full health is
// drawn undamaged." Without it, armor is invisible: every rock on the field looks
// identical and the player has no way to tell the Large that needs one more round
// from the one that needs three.
//
// WHAT IS READ, AND AGAINST WHAT. `specs/overview.md` fixes no palette and
// `specs/rocks.md` names no mark — a build may crack the face, darken the body,
// break the outline, or anything else — so nothing here compares the canvas against
// a value of its own. THE SAME ROCK IS READ TWICE, once at full health and once at
// one hit left, and the two readings are compared. Reading one rock rather than two
// side by side is what makes the comparison mean anything: every rock carries its
// own slow drawn rotation and a build is free to give each its own silhouette, so
// two DIFFERENT rocks differ at almost every sample whatever their health.
//
// THE HEALTH IS POSED, NOT SHOT ON, so the reading is of the damaged LOOK and not
// of the hit flash `armor/hit-flash` grades: `setRockHealth` produces no hit, and
// the second reading is taken one tick later, well inside `HIT_FLASH_TIME` — a
// build that flashed on a posed health would be flashing without a hit.
//
// THE BOUND. The 441 samples are laid across the rock's whole body inside its
// outline (`./look.ts`); a sample counts as changed when its colour moved by more
// than `SAMPLE_DELTA` of the 441 a colour distance can span, and more than
// `MIN_CHANGED` of the 441 must have moved. That is about seven per cent of the
// rock: enough that a build must really redraw part of it, and little enough that a
// build showing damage as a few cracks passes. One tick separates the readings, so
// the rotation between them is a fraction of a degree and cannot flip thirty
// samples by that much.
//
// THE SECOND LARGE IS POSED AFTER BOTH READINGS ARE TAKEN, purely so the still this
// leaves shows a damaged rock beside an undamaged one. Nothing it does can reach a
// reading already in hand.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan } from "../assert";
import {
  captureStill,
  createHarness,
  poseRock,
  rockById,
  startPlaying,
  type Harness,
} from "../harness";
import { CHIP_SPOT, healthOf, poseHealth } from "./scene";
import { changedSamples, LOOK_SAMPLES, readLook } from "./look";

/** The health the rock is damaged down to: one hit left of its three. */
const DAMAGED = 1;

/**
 * How far a sample's colour must move to count as changed, of the 441 a colour
 * distance can span.
 *
 * Well above what a single tick of the rock's slow cosmetic rotation can do to an
 * anti-aliased edge — that shifts the drawing by well under half a pixel — and far
 * below the contrast of any mark a build would draw to say "damaged".
 */
const SAMPLE_DELTA = 16;

/** How many of the 441 samples must have changed: the item's own figure. */
const MIN_CHANGED = 30;

/** Where the undamaged companion stands for the still: clear of the rock under test. */
const COMPANION = { x: 960, y: 520 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws a Large at one hit left differently from the same Large at full health", async () => {
  startPlaying(h);
  const id = poseRock(h, "large", CHIP_SPOT.x, CHIP_SPOT.y);

  // One tick, so the rock is on the canvas, and the undamaged reading.
  await h.advance(1);
  const whole = rockById(h.snapshot(), id, "the undamaged Large");
  const entered = healthOf(whole, "the undamaged Large");
  const undamaged = readLook(h, whole);

  // The same rock, damaged, one tick later.
  poseHealth(h, id, DAMAGED);
  await h.advance(1);
  const hurt = rockById(h.snapshot(), id, "the damaged Large");
  const damaged = readLook(h, hurt);

  // And an undamaged one beside it, for the picture alone.
  poseRock(h, "large", COMPANION.x, COMPANION.y);
  await h.advance(1);
  captureStill(h, "damage");

  assertGreaterThan(
    changedSamples(undamaged, damaged, SAMPLE_DELTA),
    MIN_CHANGED,
    `of ${LOOK_SAMPLES} samples inside the rock's outline, how many a fall ` +
      `from health ${entered} to ${DAMAGED} redrew (specs/rocks.md)`,
  );
});
