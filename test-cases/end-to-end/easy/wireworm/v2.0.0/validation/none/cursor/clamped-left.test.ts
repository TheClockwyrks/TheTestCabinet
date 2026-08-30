// cursor/clamped-left — the cursor's centre stops at the band's left bound.
//
// `specs/cursor.md`: "Its center is clamped to the band's four bounds,
// `CURSOR_X_MIN` (`16`), `CURSOR_X_MAX` (`1264`), `CURSOR_Y_MIN` (`672`), and
// `CURSOR_Y_MAX` (`704`), so it never leaves the band. A movement held against a
// bound leaves the cursor resting exactly on that bound."
//
// THE POSE IS 120 UNITS INSIDE THE BOUND, AND THE INSET IS THE POINT. A clamp
// probe that started from mid-band would have to cross 624 units before it ever
// reached the bound, so a build moving at any less than 624 units per second
// would fail this item for a defect that belongs to `cursor.move-speed` — the
// exact defect the inset exists to remove. Posed 120 units out, the hold demands
// only that the cursor move at all: 120 units in a second is 28% of
// `CURSOR_SPEED`, and a build that honours the rate covers the inset in 0.28 s
// and rests on the bound for the remaining 0.72 s.
//
// THE INSET IS THE HORIZONTAL PAIR'S ALONE. `setCursor` applies the real clamp
// (`specs/instrumentation.md`), and `specs/board.md` makes the band 32 units
// tall, so a pose 120 units inside a vertical bound would land on the opposite
// bound instead; `cursor.clamped-top` and `cursor.clamped-bottom` therefore pose
// AT the opposite bound rather than inset from their own.
//
// THE WORLD IS THE CURSOR ALONE. `startPlaying` empties the four rosters and
// shuts the three world gates, so nothing on the board can move the cursor or
// take it off the screen while the key is held.
//
// WHAT THIS DOES NOT DECIDE. That `ArrowLeft` is the key that moves left is
// `controls.left-arrow`'s requirement, and the rate is `cursor.move-speed`'s.
// This point reads one number: where the cursor's centre x came to rest.

import { afterEach, beforeEach, it } from "vitest";
import { BAND_CY, CURSOR_SPEED, CURSOR_X_MIN } from "../constants";
import { assertGreaterThanOrEqual, assertLessThanOrEqual } from "../assert";
import {
  captureStill,
  createHarness,
  framesFor,
  startPlaying,
  type Harness,
} from "../harness";

/** The key bound to `left` (`specs/controls.md`). */
const KEY = "ArrowLeft";

/**
 * How far inside the bound the cursor is posed, straight off the review item.
 *
 * Small enough that reaching the bound demands no particular rate, and large
 * enough that a build which never clamped at all would carry the cursor well
 * past `CURSOR_X_MIN` inside the drive.
 */
const INSET = 120;

/**
 * The hold, in frames of the harness's 100 Hz clock: exactly one second.
 *
 * At `CURSOR_SPEED` that is 430 units of travel against a 120-unit inset, so the
 * cursor spends the greater part of the drive already resting on the bound —
 * which is the state this point reads.
 */
const HOLD_FRAMES = framesFor(1);

/**
 * How far off the bound the resting centre may be, in logical units.
 *
 * `specs/cursor.md` states the rest as exact ("resting exactly on that bound"),
 * so the only slack this allows is floating-point residue in a build's own clamp
 * arithmetic. Half a unit is below one screen pixel and cannot hide a build that
 * clamps to the wrong figure: the nearest wrong bound this case states is 656
 * units away.
 */
const BOUND_TOLERANCE = 0.5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("rests the cursor's centre on CURSOR_X_MIN and takes it no further", async () => {
  await startPlaying(h);
  await h.debug.setCursor(CURSOR_X_MIN + INSET, BAND_CY);

  // Sampled every frame, so "goes no lower" is read across the whole drive
  // rather than at the end of it: a build that overshot the bound and sprang
  // back would rest in the right place having left the band on the way.
  let lowest = (await h.snapshot()).cursor.x;
  await h.hold(KEY);
  try {
    for (let frame = 0; frame < HOLD_FRAMES; frame += 1) {
      await h.advance(1);
      lowest = Math.min(lowest, (await h.snapshot()).cursor.x);
    }
  } finally {
    await h.release(KEY);
  }
  await captureStill(h, "clamped");

  const resting = (await h.snapshot()).cursor.x;
  assertLessThanOrEqual(
    Math.abs(resting - CURSOR_X_MIN),
    BOUND_TOLERANCE,
    `the cursor's centre x after ${HOLD_FRAMES} frames of held ${KEY} from ` +
      `${CURSOR_X_MIN + INSET}, against CURSOR_X_MIN (${CURSOR_X_MIN}) — ` +
      `specs/cursor.md, and ${CURSOR_SPEED} units/s covers the ${INSET}-unit ` +
      "inset in 0.28 s",
  );
  assertGreaterThanOrEqual(
    lowest,
    CURSOR_X_MIN - BOUND_TOLERANCE,
    "the lowest centre x the cursor reported at any frame of the hold, " +
      `against CURSOR_X_MIN (${CURSOR_X_MIN})`,
  );
});
