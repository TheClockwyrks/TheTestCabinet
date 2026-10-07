// simulation/several-grippers-may-hold-one-constellation — a second holder is not
// refused.
//
// THE RULE. "A constellation may be held by several grippers at once, and the drop
// and grab steps may create that freely" (`specs/simulation.md`, Held more than
// once). Nothing in the grab step conditions a close on what already holds the
// constellation: "Every gripper of every part whose instruction is `grab` closes;
// a gripper over a mote that is not a fixture takes hold of that mote's
// constellation."
//
// AND NOTHING TEARS. The agreement check applies to the motion that follows —
// "unless every imposed motion is the same one, the run faults as `torn`", and
// "Motions agree when they are all NO MOTION, all the same translation vector, or
// all rotation about the same center in the same direction". Both parts here
// execute `grab`, whose row of the motion table is "None" for the part and "None"
// for what it holds, so the two imposed motions are both no motion and they agree.
//
// THE CONFIGURATION. A constellation of two motes, `(1, 0)` and `(2, 0)`, joined
// by a filament — "A constellation is a maximal group of motes connected by
// filaments" (`specs/field.md`) — and two arms reaching it from opposite ends,
// each over a DIFFERENT mote of the one group ("one gripper per spoke at
// `base + length * DIRS[d]`", `specs/parts.md`, with the offsets of
// `specs/field.md`):
//
//   * an arm on `(0, 0)` at rotation `0` (`DIRS[0]` is `(+1, 0)`), gripper `(1, 0)`;
//   * an arm on `(3, 0)` at rotation `3` (`DIRS[3]` is `(-1, 0)`), gripper `(2, 0)`.
//
// Both tapes hold `grab` alone, so the two closes happen in the same grab step and
// neither can be said to have come first. The two motes are the whole of the
// field, resting `HEX_PITCH` (`48`) apart, outside the `38` the collision rule
// watches.
//
// THE VERDICT. `sim.grips` reports BOTH holds — one per arm, each naming the mote
// its own gripper stood over — and the two motes it names belong to one
// constellation. The cycle reaches its boundary with no fault. A build that
// refuses a second holder, or that silently transfers the hold to the later
// gripper, ends with one grip.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertLength,
  assertNull,
} from "../assert";
import { at } from "../field";
import { armPart, solution } from "../formats";
import { BARE } from "../fixtures";
import {
  advanceCycles,
  captureStill,
  constellationOf,
  createHarness,
  gripsOf,
  heldBy,
  openBareRun,
  partIds,
  spawnConstellation,
  type Harness,
} from "../harness";

/** The two arms' spokes: opposite ends of the same two-mote constellation. */
const WEST_SPOKE = 0;
const EAST_SPOKE = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("lets two grippers take hold of one constellation in the same grab step", async () => {
  await openBareRun(h, {
    challenge: BARE,
    machine: solution([
      armPart("arm", 0, 0, WEST_SPOKE, 1, ["grab"]),
      armPart("arm", 3, 0, EAST_SPOKE, 1, ["grab"]),
    ]),
  });
  const placed = await partIds(h);
  const westArm = placed[0] ?? -1;
  const eastArm = placed[1] ?? -1;
  const ids = await spawnConstellation(
    h,
    [
      { hex: at(1, 0), type: "dust" },
      { hex: at(2, 0), type: "dust" },
    ],
    [{ a: 0, b: 1 }],
  );

  await advanceCycles(h, 1);
  await captureStill(h, "both");

  const boundary = await h.snapshot();
  assertEqual(
    boundary.sim?.status,
    "running",
    "both parts execute grab, which imposes no motion, so the motions agree and nothing tears",
  );
  assertNull(
    boundary.sim?.fault ?? null,
    "two holders imposing the same no motion raise no fault",
  );
  assertLength(
    boundary.sim?.grips ?? [],
    2,
    "sim.grips reports both holds: nothing about the grab step refuses a second holder",
  );
  assertLength(
    gripsOf(boundary, westArm),
    1,
    "the west arm's one gripper is holding",
  );
  assertLength(
    gripsOf(boundary, eastArm),
    1,
    "the east arm's one gripper is holding",
  );
  assertEqual(
    heldBy(boundary, westArm, WEST_SPOKE),
    ids[0] ?? -1,
    "the west arm holds the mote its own gripper stood over",
  );
  assertEqual(
    heldBy(boundary, eastArm, EAST_SPOKE),
    ids[1] ?? -1,
    "the east arm holds the mote its own gripper stood over",
  );
  assertDeepEqual(
    constellationOf(boundary, ids[0] ?? -1),
    [...(ids as number[])].sort((a, b) => a - b),
    "the two motes the two grippers hold are motes of ONE constellation",
  );
});
