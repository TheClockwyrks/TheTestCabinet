// parts/grippers-pass-off-the-field — a gripper turns out past the field boundary
// and back without fault.
//
// THE RULE. "Only motes collide, so a gripper and the drawn arm between base and
// gripper pass over any hex, on or off the field, and over any part"
// (`specs/parts.md`, Arms). What "on the field" means is `specs/field.md`: "The
// field is the hexagonal region of radius `FIELD_R` around `(0, 0)`: hex `(q, r)`
// is on the field exactly when `max(|q|, |r|, |q + r|) <= FIELD_R`", with
// `FIELD_R` `5`. Only placement cares about that boundary — placement rule 1
// requires "an arm or wheel's anchor" to be on the field, and says nothing about
// where its grippers reach.
//
// THE CONFIGURATION. One `arm` anchored on `(0, -5)`, a hex on the field's own
// boundary, at rotation `0` and length `ARM_MAX_LEN` (`3`), so its gripper stands
// on `(3, -5)` — on the field — at rest. Its tape is `["rotate-ccw",
// "rotate-cw"]`: the first cycle turns it one step counterclockwise, putting the
// gripper on `(0, -5) + 3 * DIRS[5]` = `(3, -8)`, whose figure is `8` and so is
// OFF the field; the second turns it back. The arm holds nothing and the field is
// emptied, so no mote exists to collide with and the only question the cycle asks
// is whether a gripper may leave the field.
//
// THE VERDICT. Both cycles reach their boundary with `sim.status` still `running`
// and no fault. The arm's live rotation is `5` after the first — so the gripper
// really was off the field rather than held back — and `0` again after the
// second, with the base still on its anchor.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull, assertNull } from "../assert";
import { ARM_MAX_LEN } from "../constants";
import { at, onField } from "../field";
import { armPart, solution } from "../formats";
import { BARE } from "../fixtures";
import { gripperHex } from "../parts";
import {
  advanceCycles,
  captureReplay,
  createHarness,
  openBareRun,
  partIds,
  poseOf,
  type Harness,
} from "../harness";

/** An anchor on the field's boundary, and the longest reach an arm has. */
const EDGE = at(0, -5);
const LENGTH = ARM_MAX_LEN;
/** The rotation whose gripper hex lies outside the field, and the one at rest. */
const OUT = 5;
const HOME = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("turns an edge arm's gripper off the field and back with no fault", async () => {
  // The geometry the check claims to be posing, read off `specs/field.md`'s own
  // formula: the anchor is on the field, the resting gripper is on it, and the
  // gripper the first cycle turns to is off it.
  assertEqual(
    onField(EDGE),
    true,
    "the arm's anchor is on the field, as placement rule 1 requires",
  );
  assertEqual(
    onField(gripperHex(EDGE, HOME, LENGTH)),
    true,
    "at rest the gripper stands on a hex of the field",
  );
  assertEqual(
    onField(gripperHex(EDGE, OUT, LENGTH)),
    false,
    "one counterclockwise step puts the gripper on a hex past the FIELD_R boundary",
  );

  await openBareRun(h, {
    challenge: BARE,
    machine: solution([
      armPart("arm", EDGE.q, EDGE.r, HOME, LENGTH, ["rotate-ccw", "rotate-cw"]),
    ]),
  });
  const arm = (await partIds(h))[0] ?? -1;

  const [midway, snapshot] = await captureReplay(h, "edge", async () => {
    await advanceCycles(h, 1);
    const off = await h.snapshot();
    await advanceCycles(h, 1);
    return [off, await h.snapshot()] as const;
  });

  const outSim = midway.sim;
  assertNotNull(outSim, "the run is live after the cycle that turned outward");
  assertEqual(
    outSim?.status,
    "running",
    "a gripper passing off the field faults nothing: the cycle reaches its boundary",
  );
  assertNull(outSim?.fault ?? null, "no fault is raised by leaving the field");
  assertEqual(outSim?.cycle, 1, "the outward cycle ran to its boundary");
  assertEqual(
    poseOf(midway, arm)?.rotation,
    OUT,
    "the arm really turned outward, so its gripper really was off the field",
  );

  const sim = snapshot.sim;
  assertNotNull(sim, "the run is live after the cycle that turned back");
  assertEqual(
    sim?.status,
    "running",
    "the return cycle reaches its boundary too",
  );
  assertNull(
    sim?.fault ?? null,
    "no fault is raised by coming back onto the field",
  );
  assertEqual(sim?.cycle, 2, "both cycles ran to their boundaries");
  assertEqual(
    poseOf(snapshot, arm)?.rotation,
    HOME,
    "the arm is back at the rotation it started from, its gripper on the field again",
  );
  assertEqual(
    `${poseOf(snapshot, arm)?.cell.q},${poseOf(snapshot, arm)?.cell.r}`,
    `${EDGE.q},${EDGE.r}`,
    "the arm's base never left its anchor: a rotation moves no base",
  );
});
