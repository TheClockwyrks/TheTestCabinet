// instrumentation/set-pose-rotation — `setPoseRotation` turns a part's LIVE pose
// with no tape running, and leaves its rest rotation alone.
//
// THE RULE. "`setPoseRotation(part, rotation)` | Sets that part's live rotation in
// `sim.poses`, `0` to `5`, leaving its rest rotation in `editor.parts` as it
// stands." (`specs/instrumentation.md`, The run). It is the gate the same file
// names for a part's live pose: "`setPoseRotation`, `setPoseLength`, and
// `setPoseCell`, which move it with no tape running", and the machine group says
// the same from the other side: "A part's rest pose and its live pose are
// separate". Where the pose puts the grippers: "one gripper per spoke at `base +
// length * DIRS[d]`... The part's rotation names its first spoke"
// (`specs/parts.md`), and `setGrip` reads exactly that — "The spokes and the hexes
// are the part's as its live pose stands."
//
// THE WORLD IS POSED, NOT SEARCHED. A bare run with one arm at the middle, rest
// rotation `0`, length `1`, AND AN EMPTY TAPE — so no instruction can turn it and
// the only thing that ever moves it is the pose this check makes. Two `dust` are
// spawned: one on `(1, 0)`, the gripper's hex before the pose, and one on
// `(-1, 1)`, the gripper's hex after it — `(0, 0) + DIRS[2]`.
//
// THE VERDICT. `sim.poses` reports the arm at rotation `2` while `editor.parts`
// still reports its rest rotation `0`. The gripper really stands where the posed
// rotation puts it, read through the one operation that reads a gripper's hex off
// the live pose: `setGrip` on spoke `2` takes up the mote on `(-1, 1)`, and
// `setGrip` on spoke `0` — the spoke the arm carried its gripper on before the
// pose — throws, because the whole part turned rather than gaining a second arm.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertLength,
  assertNotNull,
  assertTrue,
} from "../assert";
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

/** The gripper's hex at rest rotation `0`, and at the posed rotation `2`. */
const AT_REST = at(1, 0);
const AT_POSE = at(-1, 1);

/** The rotation posed: two steps clockwise of the arm's rest rotation. */
const POSED_ROTATION = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("sets the live rotation, leaves the rest rotation, and stands the gripper at the pose", async () => {
  await openBareRun(h, {
    challenge: BARE,
    machine: solution([armPart("arm", ORIGIN.q, ORIGIN.r, 0, 1, [])]),
  });
  const arm = (await partIds(h))[0] ?? -1;
  const atRest = await spawnMote(h, AT_REST, "dust");
  const atPose = await spawnMote(h, AT_POSE, "dust");
  const before = await h.snapshot();

  await posePart(h, arm, { rotation: POSED_ROTATION });
  const posed = await h.snapshot();
  await h.advance(1);
  await captureStill(h, "posed");

  await h.debug.setGrip(arm, POSED_ROTATION, atPose);
  const taken = await h.snapshot();
  const stale = await refusalOf(() => h.debug.setGrip(arm, 0, atRest));

  assertNotNull(before.sim, "the run is live before the pose");
  assertEqual(
    poseOf(before, arm)?.rotation,
    0,
    "the run started the arm at its rest rotation, so the pose has somewhere to move it from",
  );
  assertEqual(
    poseOf(posed, arm)?.rotation,
    POSED_ROTATION,
    "setPoseRotation sets the part's live rotation in sim.poses",
  );
  assertEqual(
    partById(posed, arm)?.rotation,
    0,
    "its rest rotation in editor.parts stands: a rest pose and a live pose are separate",
  );
  assertEqual(
    heldBy(taken, arm, POSED_ROTATION),
    atPose,
    "the gripper stands on the hex the posed rotation puts it on, which is where setGrip reads it",
  );
  assertTrue(
    stale instanceof Error,
    "the arm carries no gripper on the spoke it turned away from, so the whole part moved rather than gaining one",
  );
  assertLength(
    taken.sim?.grips ?? [],
    1,
    "one gripper holds, and it is the one the posed rotation stands on",
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
