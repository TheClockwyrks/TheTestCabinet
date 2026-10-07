// instructions/period-counts-wheel-tapes — a wheel's tape is counted into the
// period exactly as an arm's is.
//
// THE RULE. "Every arm and wheel carries a tape ... The machine's period `P` is
// the largest tape length across its arms and wheels"
// (`specs/instructions.md`, Tapes and the period). `specs/parts.md` says the same
// from the wheel's side: "A wheel carries a tape like an arm". So the maximum is
// taken over the wheels as well, and a wheel's tape can be the one that sets it.
//
// THE CONFIGURATION. One challenge open, an empty machine, and two parts: an arm
// whose tape is of length `2` and a wheel whose tape is of length `4` — the very
// machine the review item names. The wheel's tape carries `rotate-cw` and
// `rotate-ccw`, the two instructions `specs/instructions.md` says "A wheel
// executes", with a blank between them so its length is the index of its last
// non-blank cell plus one; the arm carries `grab` and `drop`. The two anchors are
// distinct hexes of the field and nothing else is placed. No run is started: the
// period is the editor's figure over the machine as it stands, and no cycle need
// run for a tape to be measured.
//
// WHY THE WHEEL IS TAKEN OFF AGAIN. A build that took the maximum over its ARMS
// alone would report `2` here, and this check would catch it — but a build that
// reported `4` for some reason of its own would not be caught by one reading. So
// the wheel is removed and the figure read again: the period falls to the arm's
// `2`, which is the same maximum with the wheel's tape gone, and the `4` is
// pinned on the wheel that carried it.
//
// THE VERDICT. The arm's tape is `2` long and the wheel's is `4`, the machine
// reports a period of `4`, and with the wheel removed it reports `2`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull } from "../assert";
import { armPart, solution } from "../formats";
import { BARE } from "../fixtures";
import {
  captureStill,
  createHarness,
  loadMachine,
  openChallengeDocument,
  partById,
  partIds,
  type Harness,
} from "../harness";

/** The arm's tape, of length 2, and the wheel's, of length 4. */
const MACHINE = solution([
  armPart("arm", 0, 0, 0, 1, ["grab", "drop"]),
  armPart("wheel", 3, 0, 0, 1, ["rotate-cw", null, null, "rotate-ccw"]),
]);

/** The two tape lengths, in placement order, and the period they give. */
const ARM_LENGTH = 2;
const WHEEL_LENGTH = 4;
const PERIOD = WHEEL_LENGTH;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("takes the period across the wheels as well as the arms", async () => {
  await openChallengeDocument(h, BARE);
  await h.debug.clearMachine();
  await loadMachine(h, MACHINE);
  const [arm = -1, wheel = -1] = await partIds(h);
  await h.advance(1);
  await captureStill(h, "wheel-period");

  const posed = await h.snapshot();
  const armPlaced = partById(posed, arm);
  const wheelPlaced = partById(posed, wheel);
  assertNotNull(armPlaced, "the arm is on the machine");
  assertNotNull(wheelPlaced, "the wheel is on the machine");
  assertEqual(
    wheelPlaced?.kind,
    "wheel",
    "the second part placed is the wheel",
  );
  assertEqual(
    armPlaced?.tape?.length,
    ARM_LENGTH,
    "the arm carries a tape of length 2",
  );
  assertEqual(
    wheelPlaced?.tape?.length,
    WHEEL_LENGTH,
    "the wheel carries a tape of length 4",
  );
  assertEqual(
    posed.editor.period,
    PERIOD,
    "the period is 4: the largest tape length across the arms AND the wheels",
  );

  await h.debug.removePart(wheel);
  await h.advance(1);
  const without = await h.snapshot();
  assertEqual(
    without.editor.period,
    ARM_LENGTH,
    "with the wheel taken off, the period falls to the arm's 2: the 4 was the wheel's tape",
  );
});
