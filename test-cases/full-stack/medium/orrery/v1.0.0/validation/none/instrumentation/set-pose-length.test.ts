// instrumentation/set-pose-length — `setPoseLength` sets a part's LIVE length with
// no tape running, and leaves its rest length alone.
//
// THE RULE. "`setPoseLength(part, length)` | Sets that part's live length,
// `ARM_MIN_LEN` (`1`) to `ARM_MAX_LEN` (`3`), the same way."
// (`specs/instrumentation.md`, The run) — "the same way" being
// `setPoseRotation`'s: "leaving its rest rotation in `editor.parts` as it stands".
// It is the gate the same file names for a part's live pose: "`setPoseRotation`,
// `setPoseLength`, and `setPoseCell`, which move it with no tape running", and
// "A part's rest pose and its live pose are separate". What the length decides:
// "one gripper per spoke at `base + length * DIRS[d]`" (`specs/parts.md`), which
// is the hex `setGrip` reads — "The spokes and the hexes are the part's as its
// live pose stands."
//
// THE WORLD IS POSED, NOT SEARCHED. A bare run with one piston at the middle,
// rotation `0`, rest length `ARM_MIN_LEN` (`1`), AND AN EMPTY TAPE — so no
// `extend` and no `retract` ever runs and the only thing that changes its length
// is the pose this check makes. Two `dust` are spawned: one on `(1, 0)`, the
// gripper's hex at rest, and one on `(3, 0)`, its hex at the posed length.
//
// THE VERDICT. `sim.poses` reports the piston at length `ARM_MAX_LEN` (`3`) while
// `editor.parts` still reports its rest length `1`. The gripper really reaches
// that far: `setGrip` takes up the mote three hexes out, and refuses the mote on
// the hex the gripper stood on before the pose.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertLength,
  assertNotNull,
  assertTrue,
} from "../assert";
import { ARM_MAX_LEN, ARM_MIN_LEN } from "../constants";
import { at } from "../field";
import { armPart, solution } from "../formats";
import { BARE, ORIGIN } from "../fixtures";
import {
  captureStill,
  createHarness,
  heldBy,
  openBareRun,
  partById,
  partIds,
  poseOf,
  posePart,
  spawnMote,
  type Harness,
} from "../harness";

/** The gripper's hex at rest length `1`, and at the posed length `3`. */
const AT_REST = at(1, 0);
const AT_POSE = at(3, 0);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("sets the live length, leaves the rest length, and reaches the gripper out to it", async () => {
  await openBareRun(h, {
    challenge: BARE,
    machine: solution([
      armPart("piston", ORIGIN.q, ORIGIN.r, 0, ARM_MIN_LEN, []),
    ]),
  });
  const piston = (await partIds(h))[0] ?? -1;
  const atRest = await spawnMote(h, AT_REST, "dust");
  const atPose = await spawnMote(h, AT_POSE, "dust");
  const before = await h.snapshot();

  await posePart(h, piston, { length: ARM_MAX_LEN });
  const posed = await h.snapshot();
  await h.advance(1);
  await captureStill(h, "posed");

  await h.debug.setGrip(piston, 0, atPose);
  const taken = await h.snapshot();
  const stale = await refusalOf(() => h.debug.setGrip(piston, 0, atRest));

  assertNotNull(before.sim, "the run is live before the pose");
  assertEqual(
    poseOf(before, piston)?.length,
    ARM_MIN_LEN,
    "the run started the piston at its rest length, so the pose has somewhere to move it from",
  );
  assertEqual(
    poseOf(posed, piston)?.length,
    ARM_MAX_LEN,
    "setPoseLength sets the part's live length in sim.poses",
  );
  assertEqual(
    partById(posed, piston)?.length,
    ARM_MIN_LEN,
    "its rest length in editor.parts stands: a rest pose and a live pose are separate",
  );
  assertEqual(
    heldBy(taken, piston, 0),
    atPose,
    "the gripper stands at base + 3 * DIRS[0], which is where setGrip reads it from the live pose",
  );
  assertTrue(
    stale instanceof Error,
    "the mote on the hex the gripper stood on before the pose is no longer under it",
  );
  assertLength(
    taken.sim?.grips ?? [],
    1,
    "one gripper holds, and it is holding the mote at the posed length",
  );
});

/**
 * What `call` threw, or `null` when it returned.
 *
 * Every member of the surface answers a promise (`validation/README.md`), so a
 * refusal arrives as a rejection and is read back here rather than through
 * `assert.ts`'s synchronous throw helper.
 */
async function refusalOf(call: () => Promise<unknown>): Promise<unknown> {
  try {
    await call();
    return null;
  } catch (error) {
    return error;
  }
}
