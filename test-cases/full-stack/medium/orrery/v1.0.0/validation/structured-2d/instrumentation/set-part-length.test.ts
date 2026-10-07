// instrumentation/set-part-length — `setPartLength` sets a part's REST length.
//
// THE RULE. "`setPartLength(part, length)` | Sets that part's rest length,
// `ARM_MIN_LEN` (`1`) to `ARM_MAX_LEN` (`3`)" (`specs/instrumentation.md`, The
// machine). The length is where the grippers sit: an arm is "a base fixed on the
// anchor hex, a length, and one gripper per spoke at `base + length * DIRS[d]` for
// each spoke direction `d`", and "Length is a whole number from `ARM_MIN_LEN`
// (`1`) to `ARM_MAX_LEN` (`3`), chosen in the editor... An arm's placed rotation
// and length are its rest pose. Each run starts every arm at its rest pose"
// (`specs/parts.md`, Arms). So the posed figure is the one `startRun` raises:
// "every arm and wheel at its rest pose" (`specs/instrumentation.md`), reported as
// "`poses: [{ part, rotation, length, cell: { q, r } }]`".
//
// THE CONFIGURATION. One arm at `(0, 0)`, placed "at length `ARM_MIN_LEN` (`1`)"
// as `placePart` places every part, and then grown to `ARM_MAX_LEN` (`3`) by the
// operation under test while the machine is still being edited. Nothing else is
// placed and the field is emptied after the run starts, so nothing else carries a
// length the check could read by mistake.
//
// THE VERDICT. The machine reports the arm's rest length as `3` — moving its
// gripper two hexes further out along its spoke, by `base + length * DIRS[d]` —
// and the run raised from that machine poses the arm at length `3` rather than at
// the length it was placed with.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull } from "../assert";
import { ARM_MAX_LEN, ARM_MIN_LEN } from "../constants";
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

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("sets the rest length a run then raises the arm at", async () => {
  await h.debug.reset();
  await openChallengeDocument(h, BARE);
  const arm = await placePart(h, "arm", at(0, 0), 0);
  const placed = await h.snapshot();

  await h.debug.setPartLength(arm, ARM_MAX_LEN);
  const edited = await h.snapshot();

  await h.debug.setCompletion(false);
  await h.debug.startRun();
  await h.debug.clearMotes();
  await h.advance(1);
  await captureStill(h, "extended");
  const running = await h.snapshot();

  assertEqual(
    partById(placed, arm)?.length,
    ARM_MIN_LEN,
    "placePart places the arm at ARM_MIN_LEN, so the length under test is a change",
  );
  assertNotNull(
    partById(edited, arm),
    "the machine still reports the arm after its length is set",
  );
  assertEqual(
    partById(edited, arm)?.length,
    ARM_MAX_LEN,
    "the arm's rest length is the one setPartLength set",
  );
  assertNotNull(
    poseOf(running, arm),
    "the run poses the arm it raised from the machine",
  );
  assertEqual(
    poseOf(running, arm)?.length,
    ARM_MAX_LEN,
    "the run starts the arm at its rest pose, which is the posed length",
  );
});
