// drones/shard-fires-one — a Shard's whole dive puts exactly one bullet up.
//
// specs/drones.md, The Shard: "It takes exactly one shot over a dive."
// specs/swarm.md fixes when that shot is taken — "A diver takes its first shot in
// the frame its center first crosses `DIVE_FIRE_Y` (`360`) traveling downward" —
// and leaves how many follow to the kind, which is the figure this point reads.
//
// WHY THE DIVE IS WATCHED RATHER THAN COUNTED AT ITS END. An enemy bullet falls at
// `ENEMY_BULLET_SPEED` (`320`) and leaves the field about a second after it is
// fired, so the roster at the end of a dive holds only what was fired late in it.
// `watchDive` samples every frame and counts each bullet ONCE, by id, so a build
// that fires twice a second apart is counted as two however far the first one has
// fallen.
//
// The Shard is posed alone, sixty units above the fire line, in phase `diving`
// with its travel and its fire on and nothing else: no formation to pull a second
// diver in (`setDiveLaunching` is off through `startPosed`), no other drone to
// contribute a bullet, and the ship's contact test off, so a bullet reaching the
// ship neither ends the run nor leaves the roster early.
//
// THE DEPTH IS READ TOO. Without it a build whose dive never descends past
// `DIVE_FIRE_Y` would be credited with a count it never had the chance to break.
//
// This grades the COUNT alone. Which band that bullet carries is
// `swarm/enemy-bullet-band`'s, and where the dive goes is `swarm`'s.

import { afterEach, beforeEach, it } from "vitest";
import { DIVE_FIRE_Y, FORM_CENTER_X } from "../../src/constants";
import { assertGreaterThanOrEqual, assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  poseDrone,
  startPosed,
  ticksFor,
  type Harness,
} from "../harness";
import { watchDive } from "./dive";

/** The shots specs/drones.md gives a Shard over a dive. */
const SHOTS = 1;

/**
 * How far above `DIVE_FIRE_Y` the diving Shard starts, in logical units.
 *
 * Sixty units is a fifth of a second at `DIVE_SPEED` (`300`), so the crossing that
 * buys the shot happens early in the dive whatever path the build lays out, and it
 * is well below `FIELD_TOP` (`64`), so nothing about the entrance is in play.
 */
const ABOVE_FIRE_LINE = 60;

/** Where the diving Shard starts: on the ship's lane, above the fire line. */
const AT = { x: FORM_CENTER_X, y: DIVE_FIRE_Y - ABOVE_FIRE_LINE } as const;

/**
 * Frames the dive is watched for.
 *
 * specs/swarm.md: "A dive runs no longer than eight seconds." That is the whole
 * span a dive may occupy, so a build is held to the count over its WHOLE dive
 * however long it flies; the sweep stops itself the moment the drone leaves phase
 * `diving`, which is sooner on any build that ends its dives.
 */
const DIVE_FRAMES = ticksFor(8);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves exactly one enemy bullet over a Shard's whole dive", async () => {
  // An empty, quiet, live wave at stage 1, then exactly the one diver the
  // requirement is about.
  startPosed(h);
  const shard = poseDrone(h, "shard", AT.x, AT.y, {
    phase: "diving",
    travel: true,
    fire: true,
  });

  const dive = await watchDive(h, shard, { maxFrames: DIVE_FRAMES });
  captureStill(h, "one");

  assertGreaterThanOrEqual(
    dive.deepest,
    DIVE_FIRE_Y,
    "the depth the Shard's dive reached, past the DIVE_FIRE_Y a shot is bought " +
      "at (specs/swarm.md)",
  );
  assertLength(
    dive.shots,
    SHOTS,
    "the shots a Shard takes over one dive (specs/drones.md)",
  );
});
