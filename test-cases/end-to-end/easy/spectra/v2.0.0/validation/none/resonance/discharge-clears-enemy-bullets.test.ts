// resonance/discharge-clears-enemy-bullets — every enemy bullet on the field is
// gone once the wave has run.
//
// THE RULE. `specs/resonance.md`'s wave table: "An enemy bullet | It leaves the
// roster." It is the opposite direction of
// `resonance/discharge-spares-player-bullets`, which reads the row below it, so a
// build that leaves the whole bullet roster alone and a build that empties all of
// it grade differently.
//
// THE BULLETS ARE PLACED, NOT FIRED. `specs/instrumentation.md` gives
// `addEnemyBullet` for exactly this, so nothing here depends on a dive crossing
// `DIVE_FIRE_Y`, on which kind fires how many shots, or on any of the swarm rules
// `swarm` and `drones` grade. Each is placed in the open field and falls at
// `ENEMY_BULLET_SPEED` under the build's own stepping.
//
// THE SPAN IS CHOSEN SO A BULLET CANNOT LEAVE BY ANY OTHER DOOR, which is what
// makes the reading a verdict rather than a coincidence. `specs/field.md` removes
// an enemy bullet whose centre falls below `FIELD_BOTTOM` (656), and the ship's
// contact test — which would take one that reached the hull — is one of the three
// gates `startPosed` shuts and is left shut, since a bullet reaching the ship is
// `bands`' requirement and not this one. Over the wave's whole life a bullet
// covers 160 units, so one starting at y = 250 ends at y = 410: inside this span,
// a bullet off the roster is one the wave took.
//
// BOTH BANDS, because a bullet's band is fixed for its life and the wave is
// band-blind, so a build filtering the roster by band has to fail on one of them.
//
// WHAT THIS DOES NOT DECIDE. That the wave spares the player's own bullets is
// `resonance/discharge-spares-player-bullets`; what an enemy bullet does when it
// reaches the ship is `bands`'.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertLength,
  assertUndefined,
  fail,
} from "../assert";
import { BANDS, DISCHARGE_MAX_R, DISCHARGE_TIME } from "../constants";
import {
  bulletById,
  captureStill,
  createHarness,
  enemyBullets,
  framesFor,
  lastBullet,
  startPosed,
  type Harness,
} from "../harness";
import { release } from "./wave";

/**
 * Where the enemy bullets are placed, in logical units.
 *
 * Three of them, spread across the field's width in the open above the ship's
 * lane, standing 488, 350 and 488 units from the ship at `(640, 600)` — every one
 * a small fraction of `DISCHARGE_MAX_R` (1500), so the wave reaches all three
 * inside its life. None is on the ship's own `x`, so none is falling toward a
 * hull it could be absorbed by even had the contact gate been open.
 */
const BULLETS_AT = [
  { x: 300, y: 250 },
  { x: 500, y: 280 },
  { x: 980, y: 250 },
] as const;

/**
 * Frames the wave is given: its whole life.
 *
 * `DISCHARGE_TIME` (0.5 s) at the harness's 100 Hz clock. The wave grows from `0`
 * to `DISCHARGE_MAX_R` (1500) over that span, so a bullet 488 units out is
 * reached a third of the way through and the reading is taken well past that.
 */
const WAVE_FRAMES = framesFor(DISCHARGE_TIME);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("takes every enemy bullet off the roster", async () => {
  await startPosed(h);
  const ids: number[] = [];
  for (const [index, at] of BULLETS_AT.entries()) {
    await h.debug.addEnemyBullet(at.x, at.y, BANDS[index % BANDS.length]);
    const added = lastBullet(await h.snapshot());
    if (added === undefined) {
      fail(
        "addEnemyBullet to append a bullet to the roster " +
          "(specs/instrumentation.md)",
        "the bullet roster was still empty after addEnemyBullet",
      );
    }
    ids.push(added.id);
  }

  const posed = await h.snapshot();
  assertLength(
    enemyBullets(posed),
    BULLETS_AT.length,
    "precondition: the enemy bullets stand on the roster before the action",
  );
  assertEqual(
    posed.ship.contact,
    false,
    "precondition: the ship's contact test is shut, so nothing but the wave " +
      "can take a bullet",
  );

  await release(h);
  await h.advance(WAVE_FRAMES);
  await captureStill(h, "cleared");
  const after = await h.snapshot();

  for (const [index, id] of ids.entries()) {
    assertUndefined(
      bulletById(after, id),
      `the enemy bullet placed at (${BULLETS_AT[index].x}, ` +
        `${BULLETS_AT[index].y}), well inside DISCHARGE_MAX_R ` +
        `(${DISCHARGE_MAX_R}) of the ship and still far above FIELD_BOTTOM: ` +
        `off the roster, since a discharge wave clears the enemy fire ` +
        `(specs/resonance.md)`,
    );
  }
});
