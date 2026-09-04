// cursor/invulnerable-ignores-contact — spawn-in invulnerability absorbs a
// contact.
//
// specs/cursor.md: "While the cursor's spawn-in invulnerability is still
// running, a contact costs no life and nothing is removed by it, so the cursor
// plays on through whatever it is standing in."
//
// THE SEGMENT IS POSED ALREADY OVERLAPPING THE CURSOR, and frozen there. The
// cursor is parked on the centre of tile (20, 19), which is (656, 704), so its
// box spans x [644, 668] and y [692, 716]; tile (20, 19) spans x [640, 672] and
// y [688, 720] and overlaps it. That is a contact by specs/cursor.md's own
// definition, held for the whole window rather than arriving once — so what is
// read is what invulnerability does to a contact, with no worm step clock and no
// arrival in the reading.
//
// THE COUNTERFACTUAL IS PART OF THE CHECK. A build that never notices a segment
// at all would satisfy "costs no life" without invulnerability having absorbed
// anything, and a check that cannot fail decides nothing. So the same posed
// contact is run twice: once with `RESPAWN_INVULN` (2.0 s) of invulnerability
// left, where the specification requires no life to be lost, and then with the
// invulnerability set to zero, where the same standing overlap must cost one.
// The two readings together say that invulnerability is what absorbed it.

import { afterEach, beforeEach, it } from "vitest";
import {
  CURSOR_Y_MAX,
  RESPAWN_INVULN,
  START_LIVES,
  tileCX,
} from "../../src/constants";
import { assertEqual, assertGreaterThan } from "../assert";
import {
  captureStill,
  createHarness,
  poseWorm,
  startPlaying,
  ticksFor,
  wormOn,
  type Harness,
} from "../harness";

/** The column the cursor is parked in, and the floor row both stand on. */
const CURSOR_COLUMN = 20;
const FLOOR_ROW = 19;

/**
 * How long the contact is held while the cursor is invulnerable, in frames: one
 * second, half of `RESPAWN_INVULN`, so the invulnerability is still running at
 * the end of it and the window is unambiguously inside it.
 */
const ABSORB_TICKS = ticksFor(1);

/**
 * How long the same contact is held once the invulnerability is gone, in
 * frames. A tenth of a second: the contact test runs every update, so a build
 * that charges for it charges within a frame or two, and a short window keeps
 * the respawn that follows out of the reading.
 */
const EXPOSED_TICKS = ticksFor(0.1);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("costs no life while the invulnerability is still running", async () => {
  startPlaying(h);
  h.debug.setLives(START_LIVES);
  h.debug.setCursorContact(true);
  h.debug.setCursor(tileCX(CURSOR_COLUMN), CURSOR_Y_MAX);
  const worm = poseWorm(h, CURSOR_COLUMN, FLOOR_ROW, 1);
  h.debug.setWormStepping(worm, false);
  h.debug.setWormBody(worm, false);
  h.debug.setCursorInvulnerable(RESPAWN_INVULN);

  await h.advance(ABSORB_TICKS);
  captureStill(h, "absorbed");
  const absorbed = h.snapshot();

  assertEqual(
    wormOn(absorbed, CURSOR_COLUMN, FLOOR_ROW) !== undefined,
    true,
    "the segment is still standing in the cursor's box",
  );
  assertGreaterThan(
    absorbed.cursor.invulnerable,
    0,
    "the spawn-in invulnerability is still running",
  );
  assertEqual(
    absorbed.lives,
    START_LIVES,
    "lives after a second of contact while invulnerable",
  );

  // The counterfactual: the same standing contact, with nothing absorbing it.
  h.debug.setCursorInvulnerable(0);
  await h.advance(EXPOSED_TICKS);
  assertEqual(
    h.snapshot().lives,
    START_LIVES - 1,
    "lives after the same contact with the invulnerability gone",
  );
});
