// resonance/kept-on-death — losing a life leaves the meter exactly where it
// stands.
//
// THE RULE. `specs/resonance.md`: "Losing a life leaves it exactly where it
// stands", beside "Spending a discharge is the only thing that lowers it." The
// obvious wrong model — the meter is part of a life, so a death clears it — is
// exactly what this point exists to catch.
//
// THE LIFE IS LOST THE WAY A PLAYER LOSES ONE. `specs/instrumentation.md` gives
// `setLives`, but posing the life count down is not losing a life: it would run
// none of the code a build puts on the death path, which is where a meter reset
// would live. So the ship's contact test — one of the three gates `startPosed`
// shuts — is turned back on and one enemy bullet of the OPPOSITE band is dropped
// on the hull, which `specs/bands.md` makes the fatal case and
// `specs/progression.md` prices at one life.
//
// THE OPPOSITE BAND IS ALSO WHAT KEEPS THE READING CLEAN. A same-band bullet
// would be absorbed and would ADD `RESONANCE_ABSORB` to the meter, so the one
// contact this scenario runs is the one that costs a life and fills nothing.
//
// LIVES ARE LEFT AT `START_LIVES`, so the hit costs a life and opens the ready
// hold rather than ending the run: a hit with no life left opens the game-over
// screen instead (specs/progression.md), which is a different event.
//
// THE METER IS READ TWICE, AND BOTH READINGS ARE THE SAME REQUIREMENT. Once in
// the frame the life was paid, and once after `READY_HOLD` has run out and the
// ship is back on its lane, because a build that clears the meter as part of
// putting the ship back would pass the first reading alone. Nothing is on the
// field to move the meter across that hold: the bullet is spent and no drone was
// posed.
//
// WHAT THIS DOES NOT DECIDE. That an opposite-band bullet costs a life is
// `bands`' and `progression`'s; what the ready hold does to the ship is
// `progression`'s.

import { afterEach, beforeEach, it } from "vitest";
import {
  ENEMY_BULLET_SPEED,
  READY_HOLD,
  RESONANCE_MAX,
  START_LIVES,
  bulletSpeedScale,
} from "../../src/constants";
import { assertCloseTo, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  startPosed,
  ticksFor,
  type Band,
  type Harness,
} from "../harness";
import { poseEnemyBulletAbove } from "./wave";

/** The other of the two bands specs/bands.md fixes; there is no third. */
function opposite(band: Band): Band {
  return band === "cyan" ? "magenta" : "cyan";
}

/**
 * Where the meter is posed, in meter points: half the ceiling.
 *
 * Clear of `0`, so a build that clears the meter on a death reads a different
 * number, and clear of `RESONANCE_MAX`, so a build that fills it instead does
 * too.
 */
const POSED_METER = RESONANCE_MAX / 2;

/**
 * How far above the ship the enemy bullet is placed, in logical units.
 *
 * Geometry, not a tolerance. The hull's contact reach against an enemy bullet is
 * `SHIP_HALF` (`15`) + `ENEMY_BULLET_HALF` (`8`) = `23` units of centre
 * separation, so `120` starts the bullet five times clear of it and the life is
 * paid for a contact the fall produced.
 */
const DROP_ABOVE = 120;

/** The speed the bullet falls at on stage 1 (specs/stages.md). */
const FALL_SPEED = ENEMY_BULLET_SPEED * bulletSpeedScale(1);

/**
 * Frames the fall is given to reach the hull.
 *
 * The time to fall the whole `DROP_ABOVE` at `FALL_SPEED` — geometry again — plus
 * two frames for the frame the bullet was placed on and for whichever frame a
 * build resolves the contact on. It expires well before the bullet could reach
 * `FIELD_BOTTOM` (`656`), fifty-six units past the ship's lane at `SHIP_Y`
 * (`600`), so a bullet culled off the field cannot stand in for one that hit.
 */
const FALL_FRAMES = ticksFor(DROP_ABOVE / FALL_SPEED) + 2;

/**
 * Seconds run out after the life is paid, so the ship is back on its lane.
 *
 * `READY_HOLD` (`1.3`) is what `specs/progression.md` gives the hold, and a fifth
 * of a second past it puts the second reading unambiguously after the respawn
 * whichever frame a build ends the hold on.
 */
const RESPAWN_SECONDS = READY_HOLD + 0.2;

/** Decimal places the meter is read to: whole-number figures, round-off only. */
const METER_DIGITS = 6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("carries the meter unchanged through a life loss and the respawn", async () => {
  // An empty, quiet, live wave: nothing on the field but the bullet below, so the
  // only thing that can cost a life or move the meter is that one contact.
  startPosed(h);
  // The one world gate this item's requirement rests on: without it the hull runs
  // no contact test and no life is ever lost.
  h.debug.setShipContact(true);
  h.debug.setResonance(POSED_METER);

  const posed = h.snapshot();
  assertEqual(posed.ship.band, "cyan", "precondition: the band the ship holds");
  assertEqual(
    posed.lives,
    START_LIVES,
    "precondition: the lives the run was posed with",
  );
  assertCloseTo(
    posed.resonance,
    POSED_METER,
    METER_DIGITS,
    "precondition: the meter the life loss is measured from",
  );

  const band = opposite(posed.ship.band);
  poseEnemyBulletAbove(h, band, DROP_ABOVE);

  const swept = await h.until((s) => s.lives < START_LIVES, {
    maxFrames: FALL_FRAMES,
  });
  captureStill(h, "kept");

  assertEqual(
    swept.hit,
    true,
    `precondition: the ${band} bullet dropped ${DROP_ABOVE} units above the ` +
      `hull, opposite the band the ship holds, cost a life inside the ` +
      `${FALL_FRAMES} frames its fall takes (specs/bands.md, ` +
      `specs/progression.md)`,
  );
  assertEqual(
    swept.snapshot.lives,
    START_LIVES - 1,
    "precondition: the opposite-band bullet cost exactly one life " +
      "(specs/progression.md)",
  );
  assertCloseTo(
    swept.snapshot.resonance,
    POSED_METER,
    METER_DIGITS,
    `the meter in the frame a life was lost: unchanged, since losing a life ` +
      `leaves it exactly where it stands (specs/resonance.md)`,
  );

  await h.advanceSeconds(RESPAWN_SECONDS);

  assertCloseTo(
    h.snapshot().resonance,
    POSED_METER,
    METER_DIGITS,
    `the meter after the READY_HOLD (${READY_HOLD}) put the ship back on its ` +
      `lane: still unchanged (specs/resonance.md)`,
  );
});
