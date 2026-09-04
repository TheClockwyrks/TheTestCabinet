// instrumentation/set-part-rotation — `setPartRotation` sets a part's REST
// rotation.
//
// THE RULE. "`setPartRotation(part, rotation)` | Sets that part's rest rotation,
// `0` to `5`" (`specs/instrumentation.md`, The machine). A rest rotation is not a
// number the machine merely carries: "Every placed arm, wheel, and sigil carries
// an anchor hex and a rotation `0` to `5`... Rotation turns the part's shape by 60
// degree steps using the formulas in `specs/field.md`", and "An arm's placed
// rotation and length are its rest pose. Each run starts every arm at its rest
// pose" (`specs/parts.md`, Arms). So the posed figure is what a run raises: "every
// arm and wheel at its rest pose" (`specs/instrumentation.md`, `startRun`),
// reported as "`poses: [{ part, rotation, length, cell: { q, r } }]`".
//
// THE CONFIGURATION. One arm at `(0, 0)`, placed at rotation `0` — "`placePart`...
// anchored on `(q, r)` at `rotation` `0` to `5`" — and then turned to rotation `4`
// by the operation under test, while the machine is still being edited. Nothing
// else is placed, so no other part's pose can stand in for this one's, and the
// field is emptied after the run starts so nothing on it can move the arm.
//
// THE VERDICT. The machine reports the arm's rest rotation as `4`, and the run
// raised from that machine poses the arm at rotation `4` — four 60 degree steps
// from where it was placed — rather than at the rotation it was placed with.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull } from "../assert";
import { at } from "../field";
import { BARE } from "../fixtures";
import {
  captureStill,
  createHarness,
  openChallengeDocument,
  partById,
  placePart,
  poseOf,
  type Harness,
} from "../harness";

/** The rest rotation the check poses: four 60 degree steps from where it placed. */
const POSED_ROTATION = 4;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("sets the rest rotation a run then raises the part at", async () => {
  await h.debug.reset();
  await openChallengeDocument(h, BARE);
  const arm = await placePart(h, "arm", at(0, 0), 0);

  await h.debug.setPartRotation(arm, POSED_ROTATION);
  const edited = await h.snapshot();

  await h.debug.setCompletion(false);
  await h.debug.startRun();
  await h.debug.clearMotes();
  await h.advance(1);
  await captureStill(h, "turned");
  const running = await h.snapshot();

  assertNotNull(
    partById(edited, arm),
    "the machine still reports the arm after its rotation is set",
  );
  assertEqual(
    partById(edited, arm)?.rotation,
    POSED_ROTATION,
    "the arm's rest rotation is the one setPartRotation set",
  );
  assertNotNull(
    poseOf(running, arm),
    "the run poses the arm it raised from the machine",
  );
  assertEqual(
    poseOf(running, arm)?.rotation,
    POSED_ROTATION,
    "the run starts the arm at its rest pose, which is the posed rotation",
  );
});
