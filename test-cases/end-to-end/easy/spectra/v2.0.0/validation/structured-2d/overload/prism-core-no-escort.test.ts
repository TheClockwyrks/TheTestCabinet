// overload/prism-core-no-escort — an overloaded core bursts and adds nothing.
//
// specs/mode.md closes the Prism's reaction with the other branch: "If the exposed
// layer is the shell, it also adds `OVERLOAD_PRISM_ESCORTS` (`1`) Shard beside it
// ... With only the core left it adds none."
//
// THE POSE IS THE OTHER BRANCH AND NOTHING ELSE. The Prism is posed with its shell
// already gone — `setDroneShell` is the one operation that writes it
// (specs/instrumentation.md) — so the exposed layer is the core, which
// specs/drones.md says reads as the opposite of the stored band. The shot's band is
// read off `effectiveBand` rather than negated from the band the check posed, so it
// really is the mismatch specs/bands.md defines against the layer that is exposed.
//
// THE BURST IS READ TOO, and it is load-bearing rather than a second requirement:
// without it a build that does nothing at all on an overloaded core would pass a
// check that only counted drones. The bullets say the reaction RAN; the roster says
// it grew nothing. `overload/prism-bursts` is the point that grades the burst's own
// count and bands.
//
// THE FIRING FACULTY IS POSED ON for the reason `overload/prism-bursts` gives.
// Nothing else on the field can add a drone: `startPosed` empties the roster and
// shuts the wave's entry gate, so the only drone standing is the Prism itself.

import { afterEach, beforeEach, it } from "vitest";
import {
  FIELD_TOP,
  OVERLOAD_AT,
  PLAYER_BULLET_HALF,
  PRISM_CORE_HALF,
} from "../../src/constants";
import { assertEqual, assertGreaterThanOrEqual, assertLength } from "../assert";
import {
  LANE_CENTER,
  captureStill,
  createHarness,
  enemyBullets,
  poseDrone,
  startPosed,
  type Harness,
} from "../harness";
import { mismatchShot, poseCharge, requireDrone } from "./charge";

/** Where the target Prism stands. As in `overload/prism-bursts`. */
const TARGET_X = LANE_CENTER;
const TARGET_Y = FIELD_TOP + 156;

/**
 * The centre separation a contact needs against a Prism with only its core left.
 *
 * `PRISM_CORE_HALF` (`13`, specs/drones.md) and `PLAYER_BULLET_HALF` (`6`,
 * specs/ship.md), overlapped as circles by specs/simulation.md.
 */
const TOUCHING = PRISM_CORE_HALF + PLAYER_BULLET_HALF;

/**
 * How far below the target the shot starts, in logical units.
 *
 * More than ten times the contact reach a core has, so the bullet starts well clear
 * and climbs into it.
 */
const SHOT_BELOW = 200;

/**
 * Frames the flight is allowed.
 *
 * At `PLAYER_BULLET_SPEED` (`760`), 7.6 units per frame of the harness's 100 Hz
 * clock: the bullet enters the 19-unit contact reach 181 units up, inside 24
 * frames, and forty leaves slack for whichever sub-step a build resolves the
 * contact on.
 */
const SHOT_FRAMES = 40;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("adds no Shard when the burst layer is the core", async () => {
  startPosed(h);
  const target = poseDrone(h, "prism", TARGET_X, TARGET_Y, {
    band: "cyan",
    shell: false,
    // Its firing, because the burst this reads as evidence IS a volley.
    fire: true,
  });
  poseCharge(h, target, OVERLOAD_AT - 1);

  const before = h.snapshot();
  assertEqual(
    requireDrone(before, target, "the posed Prism").shellAlive,
    false,
    "a Prism posed with its outer shell gone, so the exposed layer is the core " +
      "(specs/drones.md)",
  );
  const had = new Set(before.drones.map((drone) => drone.id));

  const shot = await mismatchShot(h, target, {
    below: SHOT_BELOW,
    maxFrames: SHOT_FRAMES,
  });
  captureStill(h, "none");

  assertEqual(
    shot.hit,
    true,
    `the ${shot.band} shot climbing into the core's ${String(TOUCHING)}-unit ` +
      `contact reach resolved inside ${String(SHOT_FRAMES)} frames`,
  );
  assertGreaterThanOrEqual(
    enemyBullets(shot.snapshot).length,
    1,
    "the enemy bullets an overloaded core burst onto the field, which is what " +
      "says the reaction ran at all (specs/mode.md); `overload/prism-bursts` is " +
      "the point that grades their count",
  );
  assertLength(
    shot.snapshot.drones.filter((drone) => !had.has(drone.id)),
    0,
    "the drones an overloaded Prism with only its core left adds, which is none " +
      "(specs/mode.md)",
  );
});
