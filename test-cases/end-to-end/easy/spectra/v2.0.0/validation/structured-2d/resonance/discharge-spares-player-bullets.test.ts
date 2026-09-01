// resonance/discharge-spares-player-bullets — every friendly bullet on the field
// is still in flight once the wave has run.
//
// THE RULE. specs/resonance.md's wave table, the second row that is a survival:
// "One of the player's bullets | Nothing." It is the opposite direction of
// `resonance/discharge-clears-enemy-bullets`, which reads the row above it, so a
// build that empties the whole bullet roster on a discharge and a build that
// empties only the enemy half grade differently.
//
// A SURVIVAL IS VACUOUS UNLESS THE WAVE REALLY SWEPT OVER IT. A build whose
// discharge does nothing at all leaves the player's bullets in flight too, so the
// wave is sampled frame by frame and each bullet is required to have been REACHED
// as specs/resonance.md defines reached — "when that thing's center lies inside
// the wave's current radius" — before its survival is read. Bullet and radius are
// taken from the SAME snapshot, so a bullet climbing the field is judged where it
// stood when the radius was read. The reach is a PRECONDITION; the verdict is the
// survival.
//
// THE BULLETS ARE PLACED, NOT FIRED. specs/instrumentation.md gives
// `addPlayerBullet` for exactly this, so nothing here depends on the cannon's
// cadence, its cap or the flip lockout, all of which are `ship`'s. They are
// placed just above the ship's lane, which is where a fired shot is, and they
// climb at `PLAYER_BULLET_SPEED` under the build's own stepping.
//
// THE SPAN IS CHOSEN SO A BULLET CANNOT LEAVE BY ANY OTHER DOOR. specs/field.md
// removes a player bullet whose centre climbs above `FIELD_TOP` (`64`); over the
// wave's whole life a bullet covers {@link CLIMB_UNITS} units, so the highest of
// these ends {@link CLEARANCE} units below that edge. Inside this span, a bullet
// off the roster is one the wave took.
//
// BOTH BANDS, because a bullet's band is fixed for its life and the wave is
// band-blind: a build filtering the roster by band must fail on one of them.
//
// WHAT THIS DOES NOT DECIDE. That the wave clears the ENEMY bullets is
// `resonance/discharge-clears-enemy-bullets`; where a fired shot appears and how
// fast it climbs is `ship`'s.

import { afterEach, beforeEach, it } from "vitest";
import {
  DISCHARGE_MAX_R,
  DISCHARGE_TIME,
  FIELD_TOP,
  MAX_PLAYER_BULLETS,
  PLAYER_BULLET_SPEED,
} from "../../src/constants";
import {
  assertDefined,
  assertEqual,
  assertLength,
  assertTrue,
} from "../assert";
import {
  bulletById,
  captureStill,
  createHarness,
  playerBullets,
  posePlayerBullet,
  seconds,
  startPosed,
  ticksFor,
  type Harness,
} from "../harness";
import { BANDS, everReached, release, sweep } from "./wave";

/**
 * Where the player's bullets are placed, in logical units.
 *
 * `MAX_PLAYER_BULLETS` (`3`) of them — the most specs/ship.md lets a build have
 * in flight, so no build can refuse one — just above the ship's lane at `SHIP_Y`
 * (`600`), where a fired shot is, and spread across the field so they stand 204,
 * 40 and 204 units from the ship: all three inside the wave's radius early in its
 * life, none of them on top of another.
 */
const BULLETS_AT = [
  { x: 440, y: 560 },
  { x: 640, y: 560 },
  { x: 840, y: 560 },
] as const;

/**
 * Frames the wave is given: its whole life.
 *
 * `DISCHARGE_TIME` (`0.5` s) at the harness's 100 Hz clock, sampled one frame at
 * a time so every radius the wave passed through is read.
 */
const WAVE_TICKS = ticksFor(DISCHARGE_TIME);

/**
 * How far one of the player's bullets climbs over that span, in logical units,
 * at the `PLAYER_BULLET_SPEED` (`760`) specs/ship.md fixes.
 */
const CLIMB_UNITS = seconds(WAVE_TICKS) * PLAYER_BULLET_SPEED;

/**
 * How far the highest bullet still is from the edge that removes it at the end of
 * the span, in logical units (specs/field.md).
 */
const CLEARANCE =
  Math.min(...BULLETS_AT.map((at) => at.y)) - CLIMB_UNITS - FIELD_TOP;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves every one of the player's bullets in flight", async () => {
  startPosed(h);
  const ids = BULLETS_AT.map((at, index) =>
    posePlayerBullet(h, at.x, at.y, BANDS[index % BANDS.length]),
  );

  const posed = h.snapshot();
  assertLength(
    playerBullets(posed),
    MAX_PLAYER_BULLETS,
    "precondition: the player's bullets stand on the roster before the action",
  );
  assertEqual(
    posed.discharge.active,
    false,
    "precondition: no wave is running before the action",
  );

  await release(h);
  const samples = await sweep(h, WAVE_TICKS);
  captureStill(h, "spared");
  const after = h.snapshot();

  for (const [index, id] of ids.entries()) {
    assertTrue(
      everReached(samples, (snapshot) => bulletById(snapshot, id)),
      `precondition: the wave's radius, which grows to DISCHARGE_MAX_R ` +
        `(${DISCHARGE_MAX_R}), covered the bullet placed at ` +
        `(${BULLETS_AT[index].x}, ${BULLETS_AT[index].y}), so its survival is ` +
        `one the wave declined rather than one it never reached ` +
        `(specs/resonance.md)`,
    );
    assertDefined(
      bulletById(after, id),
      `the player's ${BANDS[index % BANDS.length]} bullet after a discharge ` +
        `wave swept over it, still ${CLEARANCE} units below FIELD_TOP: in ` +
        `flight, since the wave does nothing to one of the player's bullets ` +
        `(specs/resonance.md)`,
    );
  }
});
