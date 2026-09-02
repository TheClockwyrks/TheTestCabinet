// instrumentation/ship-contact-gate — with the ship's contact test gated off, an
// opposite-band enemy bullet reaching the ship costs nothing; with it on, the same
// bullet costs a life.
//
// specs/instrumentation.md gives the gate exactly one faculty:
// `setShipContact(enabled)` gates "The ship's contact test, which is whether an
// enemy bullet or a drone body reaching the ship costs a life. Off, the ship still
// draws, still moves under input, and still fires, and no contact costs anything."
// specs/progression.md fixes what the ungated case costs: an enemy bullet of the
// band opposite the ship's reaching the ship costs one life, and losing a life
// with lives to spare puts the wave into its `ready` phase.
//
// WITHOUT IT, A SCENARIO NEAR THE SHIP CANNOT BE POSED. A diving drone flown down
// the field, an enemy bullet placed to be read in flight, a drone posed low for a
// discharge to reach — every one of those ends in a contact that costs a life,
// which enters the `ready` phase, takes the ship off the field for `READY_HOLD`,
// and leaves the check reading a wave that stopped. `startPosed` shuts this gate
// for exactly that reason, and this is where it is decided.
//
// THE BULLET IS DRIVEN INTO THE SHIP, NOT POSED ON IT. It is placed a clear
// distance above the ship's lane and left to fall under the velocity
// `addEnemyBullet` gives it, so what reaches the ship is a real approach resolved
// by the build's own contact rules. In the gated half it is flown until it has
// left the roster — which, with the contact test off, means it fell past
// `FIELD_BOTTOM` and was removed (specs/field.md) — so the reading is taken after
// the bullet has been where the ship is rather than before it arrived.
//
// THE BAND IS THE OPPOSITE OF THE SHIP'S, which is the case that costs a life:
// specs/bands.md absorbs a bullet of the ship's own band instead, and an absorbed
// bullet costs nothing whether the gate is open or shut, so it would make the
// gated half read the same either way. `startPosed` leaves the ship on cyan and
// the bullet carries magenta.
//
// AND THE SAME SCENARIO IS RUN TWICE. Gated off, the lives and the phase are held
// to being exactly what they were with the bullet gone past; gated on, the same
// approach is held to costing exactly one life. Without the second half a build
// whose contact test never fires would pass a point about holding it off.
//
// WHAT THIS DOES NOT DECIDE. What a lost life DOES — the ready hold, the ship
// leaving the field, where it returns — which are `progression/ready-hold` and its
// siblings; nor which contacts cost a life, which is `bands/shield-opposite-lethal`
// and `bands/body-always-lethal-opposite`. The one reading here is whether the
// contact test ran at all.

import { afterEach, beforeEach, it } from "vitest";
import {
  ENEMY_BULLET_SPEED,
  FIELD_BOTTOM,
  SHIP_Y,
  START_LIVES,
} from "../constants";
import { assertEqual, assertNull, assertTrue } from "../assert";
import {
  LANE_CENTER,
  captureStill,
  createHarness,
  findBullet,
  lastBullet,
  startPosed,
  ticksFor,
  type Harness,
} from "../harness";

/**
 * How far above the ship's lane the bullet starts, in logical units.
 *
 * `120`. The ship's contact reach is `SHIP_HALF` (`15`) plus `ENEMY_BULLET_HALF`
 * (`8`), which is `23` units of centre separation, so this puts the bullet in
 * flight rather than already in contact, with five times that reach to fall
 * through.
 */
const ABOVE = 120;

/**
 * Frames the gated flight is allowed, which is the fall to the bottom of the field
 * rather than to the ship.
 *
 * With the contact test off the bullet is not stopped at the ship: it carries on
 * to `FIELD_BOTTOM` (`656`) and is removed there (specs/field.md). From
 * `SHIP_Y - ABOVE` that is `176` units at `ENEMY_BULLET_SPEED` (`320`) — stage 1,
 * so `bulletSpeedScale` is `1` — which is `0.55` s. Twice that is the allowance,
 * so the reading below is taken after the bullet has passed the ship however a
 * build resolves it.
 */
const GATED_FRAMES =
  2 * ticksFor((FIELD_BOTTOM - (SHIP_Y - ABOVE)) / ENEMY_BULLET_SPEED);

/**
 * Frames the ungated flight is allowed.
 *
 * The `120` units from the bullet's centre to the ship's is `0.375` s at
 * `ENEMY_BULLET_SPEED`; twice that leaves ample slack for whichever sub-step a
 * build resolves the contact on, and still stops well short of the bottom of the
 * field.
 */
const UNGATED_FRAMES = 2 * ticksFor(ABOVE / ENEMY_BULLET_SPEED);

/** The band the bullet carries: the opposite of the cyan `startPosed` leaves. */
const BAND = "magenta" as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

/** Place one falling enemy bullet over the ship and report its id. */
function dropOnTheShip(harness: Harness): number {
  harness.debug.addEnemyBullet(LANE_CENTER, SHIP_Y - ABOVE, BAND);
  return lastBullet(harness.snapshot()).id;
}

it("costs no life while the contact test is gated off, and one while it is on", async () => {
  // ---- Gated off -----------------------------------------------------------

  startPosed(h);
  h.debug.setShipContact(false);
  h.debug.setLives(START_LIVES);
  const passing = dropOnTheShip(h);

  const passed = await h.until((s) => findBullet(s, passing) === null, {
    maxFrames: GATED_FRAMES,
  });
  // Before the assertions, so a failing gate still leaves the picture of the field
  // the bullet crossed at no cost.
  captureStill(h, "unharmed");
  assertTrue(
    passed.hit,
    `the ${BAND} bullet placed ${String(ABOVE)} units over the ship to have ` +
      `left the roster inside ${String(GATED_FRAMES)} frames — with the ` +
      `contact test off it falls past FIELD_BOTTOM (${String(FIELD_BOTTOM)}) ` +
      "and is removed there (specs/field.md), and until it has gone by the " +
      "ship this point has read nothing",
  );
  assertEqual(
    passed.snapshot.lives,
    START_LIVES,
    `the lives left after a ${BAND} enemy bullet fell through the ship with ` +
      `setShipContact(false) held, from the START_LIVES (${String(START_LIVES)}` +
      ") the wave was posed with",
  );
  assertEqual(
    passed.snapshot.phase,
    "live",
    "the phase after that same bullet — losing a life puts the wave into its " +
      '"ready" phase (specs/progression.md), and the gate holds the contact ' +
      "test off",
  );

  // ---- Gated on, on the same scenario --------------------------------------

  h.debug.reset();
  startPosed(h);
  h.debug.setShipContact(true);
  h.debug.setLives(START_LIVES);
  const striking = dropOnTheShip(h);

  const struck = await h.until((s) => findBullet(s, striking) === null, {
    maxFrames: UNGATED_FRAMES,
  });
  assertTrue(
    struck.hit,
    `the same ${BAND} bullet to leave the roster inside ` +
      `${String(UNGATED_FRAMES)} frames with setShipContact(true) — a hit ` +
      "takes the bullet off the roster (specs/bands.md)",
  );
  assertNull(
    findBullet(struck.snapshot, striking),
    `the bullet carrying id ${String(striking)} after it reached the ship`,
  );
  assertEqual(
    struck.snapshot.lives,
    START_LIVES - 1,
    "the lives left after the same approach with setShipContact(true), from " +
      `the START_LIVES (${String(START_LIVES)}) the wave was posed with — ` +
      "without this half, an unchanged life count while the gate was off says " +
      "nothing about the gate",
  );
});
