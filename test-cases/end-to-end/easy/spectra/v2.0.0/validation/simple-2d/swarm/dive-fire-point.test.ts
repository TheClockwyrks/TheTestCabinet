// swarm/dive-fire-point — the shot is taken as the diver crosses DIVE_FIRE_Y.
//
// specs/swarm.md, "Enemy fire": "A diver takes its first shot in the frame its
// center first crosses `DIVE_FIRE_Y` (`360`) traveling downward."
//
// So two frames are read off one sweep — the frame the drone's centre first goes
// from above the line to at or below it, and the frame the first enemy bullet
// appears — and the point is that they are the same frame. WHERE the shot comes from
// and how many follow are the kind's (`specs/drones.md`, graded by
// `drones/shard-fires-one` and its neighbours); this reads only WHEN.
//
// WHY ONE FRAME OF SLACK. A sample is taken at the end of each driven frame, so a
// build that spawns its bullet in the same update as the crossing reads on the same
// sample, and one that notices the crossing and fires in the update that follows
// reads one sample later — a hundred and twentieth of a second of game time, and
// two and a half units of the dive's travel. Anything looser would stop being the
// frame the specification names: at the speed a dive runs, a shot ten frames late is
// twenty-five units down the field.
//
// THE DIVE IS POSED ABOVE THE LINE, a hundred units over it, so the crossing happens
// early in whatever path the build lays out and there is no doubt the drone came to
// the line from above. Travel and firing are the drone's only faculties;
// `startPosed` shuts the wave's entry and dive gates, so nothing else is on the
// field to fire and the ship's contact test is off, so the bullet that is fired
// neither costs a life nor ends the wave.

import { afterEach, beforeEach, it } from "vitest";
import { DIVE_FIRE_Y, FORM_CENTER_X } from "../../src/constants";
import { assertLessThanOrEqual, assertTrue } from "../assert";
import {
  captureStill,
  createHarness,
  enemyBullets,
  findDrone,
  poseDrone,
  startPosed,
  ticksFor,
  type Harness,
} from "../harness";

/** The stage the dive is posed at: the first, which `startPosed` opens. */
const STAGE = 1;

/** How many frames the shot may fall from the crossing: one, as the header says. */
const FRAME_TOLERANCE = 1;

/** The whole span a dive may occupy (`specs/swarm.md`), in frames. */
const DIVE_FRAMES = ticksFor(8);

/** Where the dive is posed: a hundred units above the fire line. */
const AT = { x: FORM_CENTER_X + 96, y: DIVE_FIRE_Y - 100 } as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("puts the diver's first bullet up in the frame it crosses DIVE_FIRE_Y", async () => {
  startPosed(h);
  const id = poseDrone(h, "shard", AT.x, AT.y, {
    phase: "diving",
    travel: true,
    fire: true,
  });

  // One sweep, sampling both the drone's depth and the enemy roster every frame,
  // stopped by the first bullet to appear.
  const seen: { y: number; shots: number }[] = [];
  const swept = await h.until(
    (snapshot) => {
      seen.push({
        y: findDrone(snapshot, id)?.y ?? Number.NaN,
        shots: enemyBullets(snapshot).length,
      });
      return enemyBullets(snapshot).length > 0;
    },
    { maxFrames: DIVE_FRAMES, poll: 1 },
  );
  captureStill(h, "shot");

  const crossing = seen.findIndex(
    (sample, index) =>
      index > 0 && seen[index - 1].y < DIVE_FIRE_Y && sample.y >= DIVE_FIRE_Y,
  );
  const shot = seen.findIndex((sample) => sample.shots > 0);

  assertTrue(
    crossing >= 0,
    `the diving drone's centre to have crossed DIVE_FIRE_Y ` +
      `(${String(DIVE_FIRE_Y)}) downward inside the ${String(seen.length)} ` +
      `frames swept, having been posed ${String(DIVE_FIRE_Y - AT.y)} units ` +
      `above it at stage ${String(STAGE)} (specs/swarm.md)`,
  );
  assertTrue(
    swept.hit && shot >= 0,
    `an enemy bullet from the diver inside the eight seconds a dive may run ` +
      `(specs/swarm.md)`,
  );
  assertLessThanOrEqual(
    Math.abs(shot - crossing),
    FRAME_TOLERANCE,
    `the frames between the diver's centre first crossing DIVE_FIRE_Y ` +
      `(${String(DIVE_FIRE_Y)}) on frame ${String(crossing)} of the sweep and ` +
      `its first shot appearing on frame ${String(shot)} (specs/swarm.md)`,
  );
});
