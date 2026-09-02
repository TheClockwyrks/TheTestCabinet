// swarm/dive-returns — a diver that survives comes home to its slot.
//
// specs/swarm.md, "The dive": "Once the path is done the drone enters phase
// `returning` and travels back to its slot, reaching it within four seconds, where
// it enters phase `formation` again and may be launched into a later dive." A dive
// itself "runs no longer than eight seconds", so a survivor is back in its slot
// within twelve of the launch.
//
// THE RE-SETTLE ALONE IS GRADED HERE, and that is deliberate: v1.0.0 read the
// bottom-to-top wrap of a legitimately wrapping dive as a failure to come home, and
// a build that wraps honestly but never returns was named for the same fault as one
// that jumped. `swarm/dive-continuous` grades the path; this reads only where the
// drone ended up. It asks nothing about the ROUTE home — a build that returns over
// the top of the field and one that climbs straight back both pass.
//
// "AT ITS SLOT" is the slot the drone reports plus the sway the block rides
// (`specs/field.md`), so the horizontal reading allows the whole `SWAY_AMP` (20)
// the offset can reach and one unit besides, and the vertical reading is the slot's
// outright.
//
// ONE DRONE, launched into a dive from its slot with travel on and firing off:
// nothing it would shoot reaches the ship, and `startPosed` shuts the wave's entry
// and dive gates, so nothing joins it and nothing launches it a second time once it
// is home.

import { afterEach, beforeEach, it } from "vitest";
import { SWAY_AMP, slotX, slotY } from "../constants";
import { assertEqual, assertLessThanOrEqual, assertTrue } from "../assert";
import {
  captureStill,
  createHarness,
  droneOf,
  findDrone,
  poseDrone,
  startPosed,
  ticksFor,
  type Harness,
} from "../harness";

/** The stage the dive is posed at: the first, which `startPosed` opens. */
const STAGE = 1;

/** The slot the diver flies home to: off the grid's centre column. */
const SLOT = { col: 6, row: 1 } as const;

/**
 * The seconds the whole flight is given, dive and return together.
 *
 * `specs/swarm.md` allows a dive eight seconds and the return that follows it four,
 * so twelve is the specification's own bound on the round trip; one more is the
 * sampling's.
 */
const HOME_BY = 13;

/** How often the flight is sampled while it is waited out, in seconds. */
const POLL = 0.1;

/** How far from its slot the drone may settle: the sway's reach, and one unit. */
const X_TOLERANCE = SWAY_AMP + 1;
const Y_TOLERANCE = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("brings a surviving diver back to phase formation at its slot", async () => {
  startPosed(h);
  const id = poseDrone(h, "shard", slotX(SLOT.col), slotY(SLOT.row), {
    phase: "diving",
    travel: true,
  });

  const home = await h.until(
    (snapshot) => findDrone(snapshot, id)?.phase === "formation",
    { maxFrames: ticksFor(HOME_BY), poll: ticksFor(POLL) },
  );
  captureStill(h, "home");

  const drone = droneOf(home.snapshot, id);
  assertTrue(
    home.hit,
    `the diver back in phase formation within ${String(HOME_BY)}s of its ` +
      `launch at stage ${String(STAGE)} — the eight seconds a dive may run ` +
      `and the four a return may take (specs/swarm.md); it was ${drone.phase} ` +
      `at (${drone.x.toFixed(0)}, ${drone.y.toFixed(0)})`,
  );
  assertEqual(
    drone.phase,
    "formation",
    `the phase the surviving diver came home in (specs/swarm.md)`,
  );
  assertLessThanOrEqual(
    Math.abs(drone.x - slotX(SLOT.col)),
    X_TOLERANCE,
    `how far the returned diver sat from its slot's x ` +
      `(${String(slotX(SLOT.col))}), allowing the block's SWAY_AMP ` +
      `(${String(SWAY_AMP)}) offset (specs/swarm.md, specs/field.md)`,
  );
  assertLessThanOrEqual(
    Math.abs(drone.y - slotY(SLOT.row)),
    Y_TOLERANCE,
    `how far the returned diver sat from its slot's y ` +
      `(${String(slotY(SLOT.row))}) (specs/swarm.md)`,
  );
});
