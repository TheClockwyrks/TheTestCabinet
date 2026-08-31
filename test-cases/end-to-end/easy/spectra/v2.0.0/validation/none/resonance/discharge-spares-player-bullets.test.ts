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
// removes a player bullet whose centre climbs above `FIELD_TOP` (64); over the
// wave's whole life a bullet covers 380 units, so one starting at y = 560 ends at
// y = 180 and is still on the field. Inside this span, a bullet off the roster is
// one the wave took.
//
// WHAT THIS DOES NOT DECIDE. That the wave clears the ENEMY bullets is
// `resonance/discharge-clears-enemy-bullets`; where a fired shot appears and how
// fast it climbs is `ship`'s.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDefined,
  assertEqual,
  assertLength,
  assertTrue,
  fail,
} from "../assert";
import { BANDS, DISCHARGE_TIME } from "../constants";
import {
  bulletById,
  captureStill,
  createHarness,
  framesFor,
  lastBullet,
  playerBullets,
  startPosed,
  type Harness,
} from "../harness";
import { everReached, release, sweep } from "./wave";

/**
 * Where the player's bullets are placed, in logical units.
 *
 * `MAX_PLAYER_BULLETS` (3) of them — the most a build can ever have in flight, so
 * no build can refuse one — just above the ship's lane at `SHIP_Y` (600), where a
 * fired shot is, and spread across the field so they stand 204, 40 and 204 units
 * from the ship: all three inside the wave's radius early in its life, none of
 * them on top of another.
 */
const BULLETS_AT = [
  { x: 440, y: 560 },
  { x: 640, y: 560 },
  { x: 840, y: 560 },
] as const;

/**
 * Frames the wave is given: its whole life.
 *
 * `DISCHARGE_TIME` (0.5 s) at the harness's 100 Hz clock, sampled one frame at a
 * time so the radii the wave passed through are all read. Over that span a bullet
 * climbing at `PLAYER_BULLET_SPEED` (760) covers 380 units, which leaves all
 * three well below `FIELD_TOP` (64) at the reading.
 */
const WAVE_FRAMES = framesFor(DISCHARGE_TIME);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves every one of the player's bullets in flight", async () => {
  await startPosed(h);
  const ids: number[] = [];
  for (const [index, at] of BULLETS_AT.entries()) {
    // Both bands, because a bullet's band is fixed for its life and the wave is
    // band-blind: a build filtering the roster by band must fail on one of them.
    await h.debug.addPlayerBullet(at.x, at.y, BANDS[index % BANDS.length]);
    const added = lastBullet(await h.snapshot());
    if (added === undefined) {
      fail(
        "addPlayerBullet to append a bullet to the roster " +
          "(specs/instrumentation.md)",
        "the bullet roster was still empty after addPlayerBullet",
      );
    }
    ids.push(added.id);
  }

  const posed = await h.snapshot();
  assertLength(
    playerBullets(posed),
    BULLETS_AT.length,
    "precondition: the player's bullets stand on the roster before the action",
  );
  assertEqual(
    posed.discharge.active,
    false,
    "precondition: no wave is running before the action",
  );

  await release(h);
  const samples = await sweep(h, WAVE_FRAMES);
  await captureStill(h, "spared");
  const after = await h.snapshot();

  for (const id of ids) {
    assertTrue(
      everReached(samples, (snapshot) => bulletById(snapshot, id)),
      `precondition: the wave's radius covered the bullet, so its survival is ` +
        `one the wave declined rather than one it never reached ` +
        `(specs/resonance.md)`,
    );
    assertDefined(
      bulletById(after, id),
      `the player's bullet after a discharge wave swept over it: still in ` +
        `flight, since the wave does nothing to one of the player's bullets ` +
        `(specs/resonance.md)`,
    );
  }
});
