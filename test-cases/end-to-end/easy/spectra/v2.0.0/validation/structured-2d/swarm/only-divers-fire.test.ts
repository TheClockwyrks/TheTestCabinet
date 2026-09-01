// swarm/only-divers-fire — a formation is silent; a dive is not.
//
// specs/swarm.md, "Enemy fire": "Only a drone in phase `diving` fires. A drone
// entering, resting in formation, or returning fires nothing."
//
// WHY BOTH HALVES ARE HERE. The silence alone would pass a build that never fires
// at all, which is not what the specification says and not what a reviewer would
// see; the shot alone would pass a build whose whole formation shoots. So one
// scenario runs both over the SAME posed drones with their firing turned ON: ten
// seconds of assembled formation with the dive gate shut must put nothing on the
// field, and then the gate is opened and the dive the wave launches must.
//
// THE FIRING GATE IS ON THROUGHOUT, which is the whole point: `setDroneFire`
// gates "the shots it takes during a dive" (`specs/instrumentation.md`), so a
// formation that stays silent with its firing enabled is silent because of its
// PHASE, which is what the specification says. Travel is on too, so the block
// rides its sway and the launched drone really flies its dive.
//
// WHY THE SILENCE IS WATCHED RATHER THAN COUNTED AT THE END. An enemy bullet
// falls at `ENEMY_BULLET_SPEED` and leaves the field about a second after it is
// fired, so a roster read ten seconds in would be empty on a build that fired at
// two seconds. The ten seconds are swept frame by frame and the first bullet to
// appear at all ends the sweep and fails the point.
//
// The dive clock is posed at `0` before the gate opens, as
// `swarm/dive-first-delay` poses it, so the launch is due from a moment this
// check chose. WHERE in the dive the shot falls is `swarm/dive-fire-point`'s;
// this reads only that the formation was silent and the diver was not.

import { afterEach, beforeEach, it } from "vitest";
import { DIVE_FIRST_DELAY } from "../../src/constants";
import { assertTrue } from "../assert";
import {
  captureStill,
  createHarness,
  enemyBullets,
  poseFormation,
  seconds,
  startPosed,
  ticksFor,
  type FormationEntry,
  type Harness,
} from "../harness";

/** The stage the formation is posed at: the first, a standard wave's. */
const STAGE = 1;

/** The seconds the assembled formation is watched for a shot: the item's ten. */
const SILENCE = 10;

/**
 * The seconds the launched dive is given to take its shot.
 *
 * The delay before the launch (`DIVE_FIRST_DELAY`, 2.0 s) and the eight seconds
 * `specs/swarm.md` allows the dive it launches, so a build that fires anywhere in
 * its dive is seen doing it.
 */
const FIRING = DIVE_FIRST_DELAY + 8;

/** The block posed: three columns of the grid's upper rows, every one firing. */
const BLOCK: FormationEntry[] = [
  { kind: "shard", col: 3, row: 0, travel: true, fire: true },
  { kind: "shard", col: 4, row: 0, travel: true, fire: true },
  { kind: "shard", col: 5, row: 0, travel: true, fire: true },
  { kind: "shard", col: 3, row: 1, travel: true, fire: true },
  { kind: "shard", col: 4, row: 1, travel: true, fire: true },
  { kind: "shard", col: 5, row: 1, travel: true, fire: true },
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("puts no enemy bullet up from a formation, and one up from a dive", async () => {
  startPosed(h);
  poseFormation(h, BLOCK);

  const resting = await h.until(
    (snapshot) => enemyBullets(snapshot).length > 0,
    { maxFrames: ticksFor(SILENCE), poll: 1 },
  );

  h.debug.setDiveClock(0);
  h.debug.setDiveLaunching(true);
  const diving = await h.until(
    (snapshot) => enemyBullets(snapshot).length > 0,
    {
      maxFrames: ticksFor(FIRING),
      poll: 1,
    },
  );
  captureStill(h, "silent");

  assertTrue(
    !resting.hit,
    `no enemy bullet on the field over ${SILENCE}s of an assembled formation ` +
      `of ${BLOCK.length} drones with their firing enabled and no dive ` +
      `launched, at stage ${STAGE} — one appeared ` +
      `${seconds(resting.frames).toFixed(2)}s in (specs/swarm.md)`,
  );
  assertTrue(
    diving.hit,
    `an enemy bullet on the field once the wave launched one of those same ` +
      `drones into a dive, within ${FIRING}s of the dive gate opening ` +
      `(specs/swarm.md)`,
  );
});
