// overload/prism-spawns-escort — an overloaded shell grows the swarm.
//
// specs/mode.md gives the second half of the Prism's reaction: "If the exposed
// layer is the shell, it also adds `OVERLOAD_PRISM_ESCORTS` (`1`) Shard beside it,
// of a band drawn from the game's own generator, entering as an escort does."
//
// SO THE READING IS THE ROSTER. The drone roster is counted before the shot and
// after it, and the drones the overload added are the ones carrying an id that was
// not live before — an identity specs/instrumentation.md guarantees, since "an id
// is never reused while the entity holding it is alive". What is asserted is that
// exactly `OVERLOAD_PRISM_ESCORTS` were added and that every one of them is a
// Shard.
//
// WHAT IS DELIBERATELY NOT ASSERTED. Where the escort stands and what band it
// carries. specs/mode.md leaves both to the build — "beside it" fixes no distance
// and "entering as an escort does" is specs/drones.md's entrance, whose path is the
// build's own — and the band is "drawn from the game's own generator", which is a
// different requirement the `instrumentation` group grades. A check that pinned
// either would be grading the reference rather than the specification.
//
// THE SHELL IS POSED STANDING, which is the branch this point is about; the other
// branch is `overload/prism-core-no-escort`, and a build that adds an escort in
// both cases or in neither grades differently on the two.
//
// THE FIELD IS EMPTY OF DRONES BUT FOR THE PRISM. `startPosed` clears the roster
// and shuts the wave's entry gate, so nothing but the reaction can add a drone over
// the scenario, and nothing here is destroyed.

import { afterEach, beforeEach, it } from "vitest";
import {
  FIELD_TOP,
  OVERLOAD_AT,
  OVERLOAD_PRISM_ESCORTS,
  PLAYER_BULLET_HALF,
  PRISM_HALF,
} from "../constants";
import { assertEqual, assertLength } from "../assert";
import {
  LANE_CENTER,
  captureStill,
  createHarness,
  poseDrone,
  startPosed,
  type Harness,
} from "../harness";
import { mismatchShot, poseCharge, requireDrone } from "./charge";

/** Where the target Prism stands. As in `overload/prism-bursts`. */
const TARGET_X = LANE_CENTER;
const TARGET_Y = FIELD_TOP + 156;

/** The centre separation a contact needs: `PRISM_HALF` + `PLAYER_BULLET_HALF`. */
const TOUCHING = PRISM_HALF + PLAYER_BULLET_HALF;

/** How far below the target the shot starts: nearly six times the contact reach. */
const SHOT_BELOW = 200;

/**
 * Frames the flight is allowed.
 *
 * At `PLAYER_BULLET_SPEED` (`760`), 7.6 units per frame of the harness's 100 Hz
 * clock: the bullet enters the contact reach inside 22 frames, and forty leaves
 * slack for whichever sub-step a build resolves the contact on.
 */
const SHOT_FRAMES = 40;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("adds OVERLOAD_PRISM_ESCORTS Shards when the burst layer is the shell", async () => {
  startPosed(h);
  const target = poseDrone(h, "prism", TARGET_X, TARGET_Y, {
    band: "cyan",
    shell: true,
  });
  poseCharge(h, target, OVERLOAD_AT - 1);

  const before = h.snapshot();
  assertEqual(
    requireDrone(before, target, "the posed Prism").shellAlive,
    true,
    "a Prism posed with its outer shell standing, which is the branch that adds " +
      "an escort (specs/mode.md)",
  );
  const had = new Set(before.drones.map((drone) => drone.id));

  const shot = await mismatchShot(h, target, {
    below: SHOT_BELOW,
    maxFrames: SHOT_FRAMES,
  });
  captureStill(h, "escort");

  assertEqual(
    shot.hit,
    true,
    `the ${shot.band} shot climbing into the Prism's ${String(TOUCHING)}-unit ` +
      `contact reach resolved inside ${String(SHOT_FRAMES)} frames`,
  );
  const added = shot.snapshot.drones.filter((drone) => !had.has(drone.id));
  assertLength(
    added,
    OVERLOAD_PRISM_ESCORTS,
    "the drones an overloaded Prism with its shell standing adds beside it " +
      "(specs/mode.md)",
  );
  for (const [index, escort] of added.entries()) {
    assertEqual(
      escort.kind,
      "shard",
      `the kind of escort ${String(index)} the overloaded shell added ` +
        "(specs/mode.md)",
    );
  }
});
