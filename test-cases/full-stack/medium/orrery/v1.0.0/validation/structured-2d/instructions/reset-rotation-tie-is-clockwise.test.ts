// instructions/reset-rotation-tie-is-clockwise — three steps either way is
// written clockwise.
//
// THE RULE. `reset` writes, third, "`rotate-cw` or `rotate-ccw`, repeated,
// whichever direction reaches the rest rotation in fewer steps. A tie of three
// steps is written as `rotate-cw`" (`specs/instructions.md`, `reset`). A tie is
// the one case "fewer" does not decide, and it exists because a rotation is a
// `DIRS` index `0` to `5` (`specs/parts.md`, `specs/field.md`): the two
// directions between two rotations account for six steps, so exactly one pair of
// rotations per rest rotation — the one three steps away — is equally far both
// ways. The rule names the winner so the expansion is a function of the machine
// rather than of the build.
//
// THE CONFIGURATION, IN TWO POSES ON ONE ARM. One challenge open in the editor,
// an empty machine, and one plain `arm` at `(0, 0)` placed at rotation `0` and
// length `1`, on no track — so the length run and the track run are both empty
// and the rotation run is the whole of the expansion after the `drop`. The first
// pose reaches the tied rotation with three `rotate-cw` before the cursor; the
// second reaches the SAME rotation from the other side, with three `rotate-ccw`.
// Both are three steps from rest in both directions. Each pose is loaded onto a
// fresh machine, so no earlier expansion is in the tape the next walk reads. No
// run is started and the focus is posed to `tape`.
//
// WHY BOTH SIDES ARE POSED. The rule is about the ROTATION reached, not about the
// way it was reached, so a build that broke the tie by retracing the walk would
// answer the two poses differently — clockwise for the first and counterclockwise
// for the second — and pass a check that only ever walked one way round. Both
// answers here are three `rotate-cw`.
//
// THE VERDICT. Both poses are answered `drop`, `rotate-cw`, `rotate-cw`,
// `rotate-cw`, and the cells before the cursor stand as they were.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertNotNull } from "../assert";
import { type InstructionName } from "../constants";
import { armPart, solution } from "../formats";
import { BARE, ORIGIN } from "../fixtures";
import {
  captureStill,
  createHarness,
  loadMachine,
  openChallengeDocument,
  partById,
  partIds,
  pressAction,
  type Harness,
} from "../harness";

/** The tie, written clockwise however the walk reached it. */
const EXPANSION: readonly InstructionName[] = [
  "drop",
  "rotate-cw",
  "rotate-cw",
  "rotate-cw",
];

/** The same rotation reached from each side: three steps out, either way. */
const POSES: readonly { label: string; prefix: readonly InstructionName[] }[] =
  [
    {
      label: "a walk that reached the tied rotation clockwise",
      prefix: ["rotate-cw", "rotate-cw", "rotate-cw"],
    },
    {
      label: "a walk that reached the tied rotation counterclockwise",
      prefix: ["rotate-ccw", "rotate-ccw", "rotate-ccw"],
    },
  ];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("writes three rotate-cw when both directions take three steps", async () => {
  await openChallengeDocument(h, BARE);

  for (const pose of POSES) {
    await h.debug.clearMachine();
    await loadMachine(
      h,
      solution([armPart("arm", ORIGIN.q, ORIGIN.r, 0, 1, [...pose.prefix])]),
    );
    const arm = (await partIds(h))[0] ?? -1;
    await h.debug.setFocus("tape");
    await h.debug.setCursor(arm, pose.prefix.length);
    await pressAction(h, "ins-reset");
    await captureStill(h, "tie-cw");

    const written = partById(await h.snapshot(), arm)?.tape;
    assertNotNull(written, `the arm is on the machine after ${pose.label}`);
    assertDeepEqual(
      written,
      [...pose.prefix, ...EXPANSION],
      `${pose.label} is three steps from rest either way, and the tie is written as rotate-cw`,
    );
  }
});
