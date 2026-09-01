// overload/prism-spawns-escort — an overloaded shell grows the swarm.
//
// specs/mode.md gives the second half of the Prism's reaction: "If the exposed layer is
// the shell, it also adds `OVERLOAD_PRISM_ESCORTS` (`1`) Shard beside it, of a band
// drawn from the game's own generator, entering as an escort does."
//
// SO THE READING IS THE ROSTER. The drone roster is counted before the shot and after
// it, and the drones the overload added are the ones carrying an id that was not live
// before — an identity specs/instrumentation.md guarantees, since "an id is never
// reused while the entity holding it is alive". What is asserted is that exactly
// `OVERLOAD_PRISM_ESCORTS` were added and that every one of them is a Shard.
//
// WHAT IS DELIBERATELY NOT ASSERTED. Where the escort stands and what band it carries.
// specs/mode.md leaves both to the build — "beside it" fixes no distance and "entering
// as an escort does" is specs/drones.md's entrance, whose path is "of your design" —
// and the band is "drawn from the game's own generator", which is a different
// requirement (`instrumentation/deterministic-core` grades the generator). A check that
// pinned either would be grading the reference rather than the specification.
//
// THE SHELL IS POSED STANDING, which is the branch this point is about; the other
// branch is `overload/prism-core-no-escort`, and a build that adds an escort in both
// cases or in neither grades differently on the two.
//
// THE FIELD IS EMPTY OF DRONES BUT FOR THE PRISM. `startPosed` clears the roster and
// shuts the wave's entry gate, so nothing but the reaction can add a drone over the
// scenario, and nothing here is destroyed.

import { afterEach, beforeEach, it } from "vitest";
import {
  FORM_CENTER_X,
  OVERLOAD_AT,
  OVERLOAD_PRISM_ESCORTS,
} from "../../src/constants";
import { assertEqual, assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  droneOf,
  poseDrone,
  startPosed,
  type Harness,
} from "../harness";
import { chargeById, mismatchShot } from "./charge";

/** Where the target Prism stands. As in `overload/prism-bursts`. */
const TARGET = { x: FORM_CENTER_X, y: 220 } as const;

/**
 * How far below the target the shot is placed, in logical units.
 *
 * Nearly six times the 34-unit contact reach a shelled Prism has against one of the
 * player's bullets (`PRISM_HALF` 28 + `PLAYER_BULLET_HALF` 6).
 */
const SHOT_BELOW = 200;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("adds OVERLOAD_PRISM_ESCORTS Shards when the burst layer is the shell", async () => {
  startPosed(h);
  const target = poseDrone(h, "prism", TARGET.x, TARGET.y, {
    band: "cyan",
    shell: true,
    charge: OVERLOAD_AT - 1,
  });

  const before = h.snapshot();
  assertEqual(
    droneOf(before, target).shellAlive,
    true,
    "a Prism posed with its outer shell standing, which is the branch that adds " +
      "an escort (specs/mode.md)",
  );
  const had = new Set(before.drones.map((drone) => drone.id));

  await mismatchShot(h, target, SHOT_BELOW);
  captureStill(h, "escort");

  assertEqual(
    chargeById(h.snapshot(), target, "the Prism that has just overloaded"),
    0,
    "the charge that says the shot really did overload the Prism (specs/mode.md); " +
      "`overload/charge-resets` is the point that grades it",
  );
  const added = h.snapshot().drones.filter((drone) => !had.has(drone.id));
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
