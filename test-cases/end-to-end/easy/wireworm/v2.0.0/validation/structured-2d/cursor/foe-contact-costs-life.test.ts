// cursor/foe-contact-costs-life — a foe reaching the cursor costs one life.
//
// specs/cursor.md: "A worm segment or a foe reaching the cursor costs one life.
// The cursor's box is `CURSOR_HALF` (`12`) units from its center on each axis
// [...] A foe reaches the cursor when the foe's box, `FOE_HALF` (`12`) units from
// its center on each axis, overlaps the cursor's box." specs/progression.md: on
// the contact, with lives to spare, "lives falls by one".
//
// THE GEOMETRY, WORKED OUT. Both boxes are 12 units to a side, so a glitch
// travelling along the cursor's own row reaches it once their centres are within
// 24 units of each other. The glitch is posed 120 units to the left of the
// cursor on that row, so it has 96 units to cover and nothing to cover them
// through: the board is empty and the level's own spawners are held off.
//
// THE GLITCH IS POSED TRAVELLING STRAIGHT ALONG THE ROW, at its own
// `GLITCH_H_SPEED` (210) with no descent, and with its mind held off. That is
// the isolation this point needs rather than a convenience: a glitch under its
// own motion descends at `GLITCH_V_SPEED` (62) and reverses every
// `GLITCH_DART_INTERVAL`, so from the band it would drop off the bottom of the
// board before it ever crossed the 96 units — the point would then be graded on
// the glitch's motion, which `foes.glitch-descends` and `foes.glitch-darts` own,
// rather than on what touching the cursor costs.
//
// The reading is `lives` falling by exactly one from `START_LIVES` (3): a build
// that ended the run instead reads 0, one that charged two lives reads 1, and one
// that noticed nothing reads 3.

import { afterEach, beforeEach, it } from "vitest";
import {
  CURSOR_Y_MAX,
  GLITCH_H_SPEED,
  START_LIVES,
  tileCX,
} from "../../src/constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  foeById,
  poseFoePoint,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";

/** The column the cursor is parked in; it sits on the floor row's centre. */
const CURSOR_COLUMN = 20;

/** How far to the left of the cursor the glitch starts, in logical units. */
const APPROACH = 120;

/**
 * How long the sweep waits for the contact, in frames.
 *
 * Two seconds. At `GLITCH_H_SPEED` the 96 units to the overlap take 0.46 s, so
 * this is generous enough that a build travelling its foes slower than the
 * specified figure still arrives, and what is read is the contact alone.
 */
const SWEEP_TICKS = ticksFor(2);

/** How near the cursor the glitch must be for the still to be worth keeping. */
const PICTURE_RANGE = 60;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("takes one life when a travelling glitch reaches the parked cursor", async () => {
  startPlaying(h);
  h.debug.setLives(START_LIVES);
  h.debug.setCursorContact(true);
  const parked = { x: tileCX(CURSOR_COLUMN), y: CURSOR_Y_MAX };
  h.debug.setCursor(parked.x, parked.y);

  const glitch = poseFoePoint(h, "glitch", parked.x - APPROACH, parked.y);
  h.debug.setFoeMind(glitch, false);
  h.debug.setFoeVelocity(glitch, GLITCH_H_SPEED, 0);

  let lives = h.snapshot().lives;
  for (let frame = 0; frame < SWEEP_TICKS; frame += 1) {
    await h.advance(1);
    const now = h.snapshot();
    lives = now.lives;
    if (lives !== START_LIVES) break;
    // The picture wanted is the last frame before the life was lost, and the
    // contact and the loss happen in one update: keep the frames the glitch is
    // closing on the cursor, the newest of which is that one.
    const foe = foeById(now, glitch);
    if (foe !== undefined && Math.abs(foe.x - parked.x) <= PICTURE_RANGE) {
      captureStill(h, "contact");
    }
  }

  assertEqual(
    lives,
    START_LIVES - 1,
    "lives after a glitch reached the cursor",
  );
});
