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
// an enemy bullet whose centre falls below `FIELD_BOTTOM` (`656`), and the ship's
// contact test — which would take one that reached the hull — is one of the three
// gates `startPosed` shuts and is left shut, since a bullet reaching the ship is
// `bands`' requirement and not this one. Over the wave's whole life a bullet
// covers `160` units, so one starting at y = `250` ends at y = `410`: inside this
// span, a bullet off the roster is one the wave took.
//
// BOTH BANDS, because a bullet's band is fixed for its life and the wave is
// band-blind, so a build filtering the roster by band has to fail on one of them.
//
// WHAT THIS DOES NOT DECIDE. That the wave spares the player's own bullets is
// `resonance/discharge-spares-player-bullets`; what an enemy bullet does when it
// reaches the ship is `bands`'.

import { afterEach, beforeEach, it } from "vitest";
import {
  DISCHARGE_MAX_R,
  DISCHARGE_TIME,
  ENEMY_BULLET_SPEED,
  FIELD_BOTTOM,
  RESONANCE_MAX,
  bulletSpeedScale,
} from "../constants";
import { assertEqual, assertLength, assertNull } from "../assert";
import {
  captureStill,
  createHarness,
  enemyBullets,
  findBullet,
  lastBullet,
  startPosed,
  ticksFor,
  type Band,
  type Harness,
} from "../harness";
import { release } from "./wave";

/**
 * Where the enemy bullets are placed, and the band each carries.
 *
 * Three of them, spread across the field's width in the open above the ship's
 * lane, standing `488`, `350` and `488` units from the ship at `(640, 600)` —
 * every one a small fraction of `DISCHARGE_MAX_R` (`1500`), so the wave reaches
 * all three inside its life. None is on the ship's own `x`, so none is falling
 * toward a hull it could be absorbed by even had the contact gate been open.
 */
const BULLETS_AT: readonly { x: number; y: number; band: Band }[] = [
  { x: 300, y: 250, band: "cyan" },
  { x: 500, y: 280, band: "magenta" },
  { x: 980, y: 250, band: "cyan" },
];

/**
 * Frames the wave is given: its whole life.
 *
 * `DISCHARGE_TIME` (`0.5` s) at the suite's clock. The wave grows from `0` to
 * `DISCHARGE_MAX_R` (`1500`) over that span, so a bullet `488` units out is
 * reached a third of the way through and the reading is taken well past that.
 */
const WAVE_TICKS = ticksFor(DISCHARGE_TIME);

/**
 * How far an enemy bullet falls over the wave's whole life, in logical units.
 *
 * Geometry, not a tolerance: `ENEMY_BULLET_SPEED` (`320`) times
 * `bulletSpeedScale(1)` (`1`) over `DISCHARGE_TIME`. It is asserted against the
 * lowest bullet's start so the span provably cannot carry one below
 * `FIELD_BOTTOM`, where `specs/field.md` would remove it for a reason that is not
 * the wave.
 */
const FALL_OVER_WAVE =
  ENEMY_BULLET_SPEED * bulletSpeedScale(1) * DISCHARGE_TIME;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("takes every enemy bullet off the roster", async () => {
  startPosed(h);
  const ids = BULLETS_AT.map((at) => {
    h.debug.addEnemyBullet(at.x, at.y, at.band);
    return lastBullet(h.snapshot()).id;
  });

  const posed = h.snapshot();
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
  for (const at of BULLETS_AT) {
    assertStaysOnField(at.y);
  }

  await release(h, RESONANCE_MAX);
  await h.advance(WAVE_TICKS);
  captureStill(h, "cleared");
  const after = h.snapshot();

  for (const [index, id] of ids.entries()) {
    assertNull(
      findBullet(after, id),
      `the enemy bullet placed at (${BULLETS_AT[index].x}, ` +
        `${BULLETS_AT[index].y}), well inside DISCHARGE_MAX_R ` +
        `(${DISCHARGE_MAX_R}) of the ship and still far above FIELD_BOTTOM ` +
        `(${FIELD_BOTTOM}): off the roster, since a discharge wave clears the ` +
        `enemy fire (specs/resonance.md)`,
    );
  }
});

/**
 * The bullet placed at `y` cannot reach `FIELD_BOTTOM` inside the wave's life.
 *
 * A precondition on the SCENARIO rather than on the build: it is arithmetic over
 * the case's own figures, and it fails the check if the geometry above is ever
 * edited into a span where `specs/field.md`'s cull could take a bullet the wave
 * was supposed to.
 */
function assertStaysOnField(y: number): void {
  assertEqual(
    y + FALL_OVER_WAVE < FIELD_BOTTOM,
    true,
    `precondition: a bullet placed at y = ${y} falls ${FALL_OVER_WAVE} units ` +
      `over the wave's life and so stays above FIELD_BOTTOM (${FIELD_BOTTOM}), ` +
      `where specs/field.md would remove it`,
  );
}
