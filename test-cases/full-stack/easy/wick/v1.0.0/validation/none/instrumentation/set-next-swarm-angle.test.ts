// Wick — instrumentation/set-next-swarm-angle: `setNextSwarmAngle(30)` on
// `playing` sets `nextSwarmAngle` to 30, the snapshot reads it back, and the
// next gnat swarm is centered along that direction with every gnat heading
// back along it.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md — "Drawn
// outcomes", `setNextSwarmAngle(degrees)`): "The next gnat swarm's direction
// `d` is the unit vector at that angle". specs/enemies.md ("Scripted
// events"): "`center = player + d * SPAWN_DISTANCE`" and "Every gnat in the
// swarm spawns with heading `-d`".
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night with `events` alone,
// carried across the 1:00 swarm's tick by the shared `poseSwarm`, which
// recovers `d` from the gnats themselves; here it is read against the angle
// that was posed.
//
// THE TOLERANCE. `POSITION_TOL` on the center, `cos` and `sin` of one angle
// scaled by 760 and averaged over twenty-four gnats; `ANGLE_TOL` on each
// heading, a unit vector.

import { afterEach, beforeEach, it } from "vitest";
import { assertAngleNear, assertEqual, assertNear } from "../assert";
import { ANGLE_TOL, POSITION_TOL, SPAWN_DISTANCE } from "../constants";
import {
  alongAngle,
  angleFrom,
  captureStill,
  createHarness,
  type Harness,
} from "../harness";
import { poseSwarm } from "../director/swarms";

const POSED_ANGLE = 30;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("poses the next swarm's direction, and the swarm comes that way", async () => {
  const swarm = await poseSwarm(h, POSED_ANGLE);
  await captureStill(h, "swarm");

  const center = alongAngle(swarm.at, POSED_ANGLE, SPAWN_DISTANCE);
  assertNear(swarm.center.x, center.x, POSITION_TOL, "the line's center x");
  assertNear(swarm.center.y, center.y, POSITION_TOL, "the line's center y");
  for (const gnat of swarm.gnats) {
    assertAngleNear(
      angleFrom({ x: 0, y: 0 }, gnat.heading),
      (POSED_ANGLE + 180) % 360,
      ANGLE_TOL,
      `gnat ${gnat.id}'s heading, back along the posed direction`,
    );
  }
  assertEqual(
    (await h.snapshot()).run.nextSwarmAngle,
    null,
    "nextSwarmAngle once the swarm took it",
  );
});
