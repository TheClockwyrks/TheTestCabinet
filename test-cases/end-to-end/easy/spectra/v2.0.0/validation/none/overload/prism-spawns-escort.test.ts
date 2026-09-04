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
// and "entering as an escort does" is specs/drones.md's entrance, whose path is
// "of your design" — and the band is "drawn from the game's own generator", which
// is a different requirement (`instrumentation/deterministic-core` grades the
// generator). A check that pinned either would be grading the reference rather than
// the specification.
//
// THE SHELL IS POSED STANDING, which is the branch this point is about; the other
// branch is `overload/prism-core-no-escort`, and a build that adds an escort in
// both cases or in neither grades differently on the two.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import {
  FORM_CENTER_X,
  OVERLOAD_AT,
  OVERLOAD_PRISM_ESCORTS,
} from "../constants";
import {
  captureStill,
  createHarness,
  poseDrone,
  requireDrone,
  startPosed,
  type Harness,
} from "../harness";
import { mismatchShot } from "./charge";

/** Where the target Prism stands. As in `overload/prism-bursts`. */
const TARGET = { x: FORM_CENTER_X, y: 220 } as const;

/**
 * How far below the target the shot is placed, in logical units.
 *
 * Nearly six times the 34-unit contact reach a shelled Prism has against one of the
 * player's bullets (`PRISM_HALF` 28 + `PLAYER_BULLET_HALF` 6).
 */
const SHOT_BELOW = 200;

/**
 * Frames the flight is allowed.
 *
 * At `PLAYER_BULLET_SPEED` (760), 7.6 units per frame of the harness's 100 Hz
 * clock: the bullet enters the contact reach inside 22 frames, and forty leaves
 * slack for whichever frame a build resolves the contact on.
 */
const SHOT_FRAMES = 40;

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

it("adds OVERLOAD_PRISM_ESCORTS Shards when the burst layer is the shell", async () => {
  await startPosed(harness);
  const target = await poseDrone(harness, "prism", TARGET.x, TARGET.y, {
    band: "cyan",
    shell: true,
    charge: OVERLOAD_AT - 1,
  });

  const before = await harness.snapshot();
  assertEqual(
    requireDrone(before, target, "the posed Prism").shellAlive,
    true,
    "a Prism posed with its outer shell standing, which is the branch that adds " +
      "an escort (specs/mode.md)",
  );
  const had = new Set(before.drones.map((drone) => drone.id));

  const shot = await mismatchShot(harness, target, {
    below: SHOT_BELOW,
    maxFrames: SHOT_FRAMES,
  });
  await captureStill(harness, "escort");

  assertEqual(
    shot.hit,
    true,
    `the ${shot.band} shot resolving inside the ${String(SHOT_FRAMES)} frames ` +
      "its climb takes",
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
