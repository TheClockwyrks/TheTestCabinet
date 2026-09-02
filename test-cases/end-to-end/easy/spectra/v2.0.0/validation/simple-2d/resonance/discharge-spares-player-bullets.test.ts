// resonance/discharge-spares-player-bullets — every friendly bullet on the field
// is still in flight once the wave has run.
//
// THE RULE. `specs/resonance.md`'s wave table, the second row that is a survival:
// "One of the player's bullets | Nothing." It is the opposite direction of
// `resonance/discharge-clears-enemy-bullets`, which reads the row above it, so a
// build that empties the whole bullet roster on a discharge and a build that
// empties only the enemy half grade differently.
//
// A SURVIVAL IS VACUOUS UNLESS THE WAVE REALLY SWEPT OVER IT. A build whose
// discharge does nothing at all leaves the player's bullets in flight too, so the
// wave is sampled frame by frame and each bullet is required to have been REACHED
// as `specs/resonance.md` defines reached — "when that thing's center lies inside
// the wave's current radius" — before its survival is read. Bullet and radius are
// taken from the SAME snapshot, so a bullet climbing the field is judged where it
// stood when the radius was read. The reach is a PRECONDITION; the verdict is the
// survival.
//
// THE BULLETS ARE PLACED, NOT FIRED. `specs/instrumentation.md` gives
// `addPlayerBullet` for exactly this — "a caller that simply wants a bullet in
// flight places one" — so nothing here depends on the cannon's cadence, its cap
// or the flip lockout, all of which are `ship`'s. They are placed just above the
// ship's lane, which is where a fired shot is, and they climb at
// `PLAYER_BULLET_SPEED` under the build's own stepping.
//
// THE SPAN IS CHOSEN SO A BULLET CANNOT LEAVE BY ANY OTHER DOOR. `specs/field.md`
// removes a player bullet whose centre climbs above `FIELD_TOP` (`64`); over the
// wave's whole life a bullet covers `380` units, so one starting at y = `560`
// ends at y = `180` and is still on the field. Inside this span, a bullet off the
// roster is one the wave took.
//
// BOTH BANDS, because a bullet's band is fixed for its life and the wave is
// band-blind, so a build filtering the roster by band has to fail on one of them.
//
// WHAT THIS DOES NOT DECIDE. That the wave clears the ENEMY bullets is
// `resonance/discharge-clears-enemy-bullets`; where a fired shot appears and how
// fast it climbs is `ship`'s.

import { afterEach, beforeEach, it } from "vitest";
import {
  DISCHARGE_TIME,
  FIELD_TOP,
  MAX_PLAYER_BULLETS,
  PLAYER_BULLET_SPEED,
  RESONANCE_MAX,
} from "../constants";
import {
  assertEqual,
  assertLength,
  assertNotNull,
  assertTrue,
} from "../assert";
import {
  captureStill,
  createHarness,
  findBullet,
  playerBullets,
  startPosed,
  ticksFor,
  type Band,
  type Harness,
} from "../harness";
import { everReached, poseShot, release, sweep } from "./wave";

/**
 * Where the player's bullets are placed, and the band each carries.
 *
 * `MAX_PLAYER_BULLETS` (`3`) of them — the most a build can ever have in flight,
 * so no build can refuse one — just above the ship's lane at `SHIP_Y` (`600`),
 * where a fired shot is, and spread across the field so they stand `204`, `40`
 * and `204` units from the ship: all three inside the wave's radius early in its
 * life, none of them on top of another.
 */
const BULLETS_AT: readonly { x: number; y: number; band: Band }[] = [
  { x: 440, y: 560, band: "cyan" },
  { x: 640, y: 560, band: "magenta" },
  { x: 840, y: 560, band: "cyan" },
];

/**
 * Frames the wave is given: its whole life.
 *
 * `DISCHARGE_TIME` (`0.5` s) at the suite's clock, sampled one frame at a time so
 * the radii the wave passed through are all read.
 */
const WAVE_TICKS = ticksFor(DISCHARGE_TIME);

/**
 * How far one of the player's bullets climbs over the wave's whole life, in
 * logical units.
 *
 * Geometry, not a tolerance: `PLAYER_BULLET_SPEED` (`760`) over `DISCHARGE_TIME`.
 * It is asserted against each bullet's start so the span provably cannot carry
 * one above `FIELD_TOP`, where `specs/field.md` would remove it for a reason that
 * is not the wave.
 */
const CLIMB_OVER_WAVE = PLAYER_BULLET_SPEED * DISCHARGE_TIME;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves every one of the player's bullets in flight", async () => {
  startPosed(h);
  const ids = BULLETS_AT.map((at) => poseShot(h, at.x, at.y, at.band));

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
  for (const at of BULLETS_AT) {
    // A precondition on the SCENARIO rather than on the build: arithmetic over
    // the case's own figures, so that if the geometry above is ever edited into
    // a span where specs/field.md's cull could take a bullet the wave was
    // supposed to spare, this check says so instead of grading the build.
    assertTrue(
      at.y - CLIMB_OVER_WAVE > FIELD_TOP,
      `precondition: a bullet placed at y = ${at.y} climbs ` +
        `${CLIMB_OVER_WAVE} units over the wave's life and so stays below ` +
        `FIELD_TOP (${FIELD_TOP}), where specs/field.md would remove it`,
    );
  }

  await release(h, RESONANCE_MAX);
  const samples = await sweep(h, WAVE_TICKS);
  captureStill(h, "spared");
  const after = h.snapshot();

  for (const id of ids) {
    // The verdict first, so a build that TOOK the bullet is named for that rather
    // than for the reach it then has no bullet left to have covered.
    assertNotNull(
      findBullet(after, id),
      `the player's bullet after a discharge wave swept over it: still in ` +
        `flight, since the wave does nothing to one of the player's bullets ` +
        `(specs/resonance.md)`,
    );
    // And then the anti-vacuity reading: a survival the wave never reached
    // decides nothing, so the sweep has to show the radius covering it.
    assertTrue(
      everReached(samples, (snapshot) => findBullet(snapshot, id)),
      `precondition: the wave's radius covered the bullet, so its survival is ` +
        `one the wave declined rather than one it never reached ` +
        `(specs/resonance.md)`,
    );
  }
});
