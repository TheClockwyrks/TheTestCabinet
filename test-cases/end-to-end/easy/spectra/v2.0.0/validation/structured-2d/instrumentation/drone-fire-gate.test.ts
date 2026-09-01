// instrumentation/drone-fire-gate — a diving drone whose firing is gated off flies
// its whole dive silent, while the same dive with firing on puts a bullet on the
// field.
//
// specs/instrumentation.md gives the operation exactly one faculty:
// `setDroneFire(id, enabled)` "Gates the drone's firing alone: the shots it takes
// during a dive. Off, it flies its whole dive silent. Its travel and its band
// clock run on."
//
// IT IS WHAT LETS A SCENARIO FLY A DIVE WITHOUT ARMING IT. specs/swarm.md has a
// diver take its first shot in the frame its centre first crosses `DIVE_FIRE_Y`
// (`360`) travelling downward, and specs/progression.md costs a life for an enemy
// bullet of the opposite band reaching the ship — which ends the live phase and
// stops the scenario that was running. So every point in this suite that reads a
// dive's PATH flies it with the fire gated off, and this is where that gate is
// decided.
//
// THE WHOLE DIVE IS FLOWN, NOT A MOMENT OF IT. specs/swarm.md bounds a dive at
// eight seconds, so the silent half runs the field for that whole span and holds
// the bullet roster to staying empty across it — a build that merely delayed its
// shot rather than withholding it is caught. The roster is sampled every tenth of
// a second, which is a tenth of the `0.93` s an enemy bullet needs to fall from
// the fire line to `FIELD_BOTTOM` at `ENEMY_BULLET_SPEED` (`320`), so a shot that
// was taken and then left the field between two samples cannot slip through.
//
// AND THE SAME DIVE IS FLOWN AGAIN WITH THE GATE OPEN. Without that half, a build
// whose divers never fire at all would pass a point about holding their fire. The
// second run is posed from scratch on an emptied field, so the bullet it reads is
// one the second dive produced.
//
// THE FIELD IS OTHERWISE EMPTY AND QUIET. `startPosed` clears the four rosters and
// shuts the three world gates, so nothing else can put a bullet on the roster over
// either span, and the ship's contact test is off, so the firing half's own shot
// cannot end the wave before the reading is taken.
//
// WHAT THIS DOES NOT DECIDE. How many shots a dive takes, where the fire line is,
// or what band a shot carries — `drones.shard-fires-one`, `swarm.dive-fire-point`
// and `swarm.enemy-bullet-band` — nor that a drone which is not diving stays
// silent, which is `swarm.only-divers-fire`.

import { afterEach, beforeEach, it } from "vitest";
import { DIVE_FIRE_Y } from "../../src/constants";
import { assertEqual, assertTrue } from "../assert";
import {
  captureStill,
  createHarness,
  enemyBullets,
  poseDrone,
  startPosed,
  ticksFor,
  type Harness,
  type SpectraSnapshot,
} from "../harness";

/** Where the diver starts: above the fire line, mid-field, on an empty stage. */
const DIVER_AT = { x: 640, y: 200 } as const;

/**
 * How long each dive is flown for, in seconds.
 *
 * Eight, which is the bound specs/swarm.md puts on a dive: "A dive runs no longer
 * than eight seconds." So the silent half covers a whole dive rather than a
 * moment of one, and the firing half gives a build the whole of its dive to take
 * the shot the specification says it takes.
 */
const DIVE_SECONDS = 8;

/**
 * How much game time separates two samples of the bullet roster, in seconds.
 *
 * A tenth of a second. An enemy bullet falls from `DIVE_FIRE_Y` (`360`) to
 * `FIELD_BOTTOM` (`656`) at `ENEMY_BULLET_SPEED` (`320`) — `0.93` s at stage 1 —
 * so a shot taken between two samples is still in flight at the next one, and a
 * build cannot fire and have the evidence leave the field unseen.
 */
const POLL_SECONDS = 0.1;

/** Whether any enemy bullet is on the roster. */
function anyEnemyBullet(s: SpectraSnapshot): boolean {
  return enemyBullets(s).length > 0;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("flies a gated dive silent, and the same dive with the gate open fires", async () => {
  // ---- Gated off ----------------------------------------------------------

  startPosed(h);
  const silent = poseDrone(h, "shard", DIVER_AT.x, DIVER_AT.y, {
    band: "cyan",
    phase: "diving",
    travel: true,
    fire: false,
  });

  const shot = await h.until(anyEnemyBullet, {
    maxFrames: ticksFor(DIVE_SECONDS),
    poll: ticksFor(POLL_SECONDS),
  });
  // Before the assertions, so a failing gate still leaves the picture of the
  // field the silent dive crossed.
  captureStill(h, "silent");
  assertEqual(
    shot.hit,
    false,
    `whether an enemy bullet appeared over the ${DIVE_SECONDS} s a dive may ` +
      `last (specs/swarm.md) with setDroneFire(${silent}, false) held, on a ` +
      `field where nothing else can fire — a diver takes its shot as it ` +
      `crosses DIVE_FIRE_Y (${DIVE_FIRE_Y}), and a gated one flies its whole ` +
      `dive silent (specs/instrumentation.md)`,
  );

  // ---- Gated on, on the same dive from an emptied field ---------------------

  startPosed(h);
  const firing = poseDrone(h, "shard", DIVER_AT.x, DIVER_AT.y, {
    band: "cyan",
    phase: "diving",
    travel: true,
    fire: true,
  });

  const fired = await h.until(anyEnemyBullet, {
    maxFrames: ticksFor(DIVE_SECONDS),
    poll: ticksFor(POLL_SECONDS),
  });
  assertTrue(
    fired.hit,
    `an enemy bullet to appear within the ${DIVE_SECONDS} s of the same dive ` +
      `posed with setDroneFire(${firing}, true) — without it, an empty roster ` +
      `while the gate was off says nothing about the gate`,
  );
});
