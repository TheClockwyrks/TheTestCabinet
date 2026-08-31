// Meltdown — combat/retargets-when-the-target-goes: a gun moves on.
//
// `specs/combat.md`: "The target is chosen again on every frame, so an emitter
// whose target dies, leaks, or leaves its range takes the next unit under the
// same rule on the following frame." So a gun holding a target that is removed
// must be reporting the next in-range unit one frame later, with nothing else
// touched.
//
// THE TARGET IS REMOVED RATHER THAN KILLED, and that is what makes this point
// about re-targeting alone. `removeUnit(id)` "costs no life, pays no bounty, and
// changes neither score nor money" (`specs/instrumentation.md`), so what the
// following frame answers is the choice and not a death, a bounty, or a wave
// clear. Whether a KILL frees the gun the same way follows from the same rule and
// is not a second requirement.
//
// THE SUCCESSOR IS ALREADY THERE, IN RANGE, AND WAS NEVER THE TARGET. Both marks
// are `95` units from the footprint centre, inside the Arc's `114`, and the east
// one is further along its route, so the first frame names it under the rule
// (`combat/targets-the-unit-furthest-along` decides that reading). With it gone,
// the west mark is the only in-range unit left, so the rule has exactly one
// answer and a build that re-targets correctly cannot report anything else.
//
// WHAT THE WRONG MODEL LOOKS LIKE. A build that latches its target on acquisition
// and only lets go when the shot resolves reports `null`, or holds the id of a
// unit that is no longer on the floor. Both are a different reading from the west
// mark's id.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { eastOfGun, poseGun, poseMarkAt, readGun } from "./duel";

/** The emitter read, and the heat it is pinned at. */
const TOWER = "arc";
const HEAT = 0;

/** Five tiles from the footprint centre: inside the Arc's `114`, off its tiles. */
const OFFSET_UNITS = 95;

const EAST = eastOfGun(TOWER, OFFSET_UNITS);
const WEST = eastOfGun(TOWER, -OFFSET_UNITS);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("A gun moves on when its target goes", async () => {
  const gunId = await poseGun(h, TOWER, HEAT);
  const west = await poseMarkAt(h, "mote", WEST.x, WEST.y);
  const east = await poseMarkAt(h, "mote", EAST.x, EAST.y);

  await h.advance(1);
  const held = await readGun(h, gunId, "the emitter with two marks in range");
  assertEqual(
    held.targeting,
    east,
    "precondition: the emitter opened on the mark further along its route",
  );

  await h.debug.removeUnit(east);
  await h.advance(1);
  await captureStill(h, "retarget");
  const moved = await readGun(h, gunId, "the emitter one frame after the removal");

  assertEqual(
    moved.targeting,
    west,
    "the unit targeted on the frame after the held target left the floor, " +
      "with one in-range unit remaining",
  );
});
