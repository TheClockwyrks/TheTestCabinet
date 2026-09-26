// instructions/reset-rotates-the-shorter-way — the rotation run is whichever
// direction reaches the rest rotation in fewer steps.
//
// THE RULE. `reset` writes, third, "`rotate-cw` or `rotate-ccw`, repeated,
// whichever direction reaches the rest rotation in fewer steps"
// (`specs/instructions.md`, `reset`). A step is 60 degrees — "`rotate-cw` | The
// part turns one 60 degree step clockwise about its base" — and rotations live on
// a ring of six: "Every placed arm, wheel, and sigil carries an anchor hex and a
// rotation `0` to `5`" (`specs/parts.md`), where "Rotating a direction index
// clockwise adds `1` modulo `6`; counterclockwise subtracts `1`"
// (`specs/field.md`). So the two directions between any two rotations always
// account for six steps between them, and "fewer" is decided by which side of
// three the walk sits on.
//
// THE CONFIGURATION, IN TWO POSES ON ONE ARM. One challenge open in the editor,
// an empty machine, and one plain `arm` at `(0, 0)` placed at rotation `0` and
// length `1`, on no track — so the length run and the track run are both empty
// and the rotation run is the whole of the expansion after the `drop`. The first
// pose gives it FOUR `rotate-cw` before the cursor, so the walk stands four steps
// clockwise of rest and TWO steps counterclockwise; the second gives it one, so
// the walk stands one step clockwise and five counterclockwise. Each pose is
// loaded onto a fresh machine, so no earlier expansion is in the tape the next
// walk reads. No run is started and the focus is posed to `tape`.
//
// THE TWO POSES ANSWER IN OPPOSITE DIRECTIONS, WHICH IS THE POINT. Four steps out
// clockwise is returned by two MORE clockwise steps rather than by four
// counterclockwise ones — the run that carries on the way the walk was going —
// and one step out clockwise is returned by one counterclockwise step, the run
// that goes back the way it came. A build that always retraced the walk fails the
// first; a build that always carried on fails the second; and a build that took
// the difference without wrapping it into `0` to `5` writes runs of four and of
// five.
//
// THE VERDICT. Four steps clockwise of rest is answered `drop`, `rotate-cw`,
// `rotate-cw`; one step clockwise is answered `drop`, `rotate-ccw`; and the cells
// before the cursor stand as they were.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertNotNull } from "../assert";
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

/** The arm's rest rotation, which every walk below is measured from. */
const REST_ROTATION = 0;

/** The two poses: four steps clockwise of rest, and one. */
const POSES: readonly {
  label: string;
  prefix: readonly InstructionName[];
  expansion: readonly InstructionName[];
}[] = [
  {
    label: "a walk four steps clockwise of the rest rotation",
    prefix: ["rotate-cw", "rotate-cw", "rotate-cw", "rotate-cw"],
    expansion: ["drop", "rotate-cw", "rotate-cw"],
  },
  {
    label: "a walk one step clockwise of the rest rotation",
    prefix: ["rotate-cw"],
    expansion: ["drop", "rotate-ccw"],
  },
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("writes the two-step run rather than the four, and the one rather than the five", async () => {
  await openChallengeDocument(h, BARE);

  for (const pose of POSES) {
    await h.debug.clearMachine();
    await loadMachine(
      h,
      solution([
        armPart("arm", ORIGIN.q, ORIGIN.r, REST_ROTATION, 1, [...pose.prefix]),
      ]),
    );
    const arm = (await partIds(h))[0] ?? -1;
    assertEqual(
      partById(await h.snapshot(), arm)?.rotation,
      REST_ROTATION,
      "the arm's rest rotation is the rotation it was placed at",
    );

    await h.debug.setFocus("tape");
    await h.debug.setCursor(arm, pose.prefix.length);
    await pressAction(h, "ins-reset");
    await captureStill(h, "shorter-run");

    const written = partById(await h.snapshot(), arm)?.tape;
    assertNotNull(written, `the arm is on the machine after ${pose.label}`);
    assertDeepEqual(
      written,
      [...pose.prefix, ...pose.expansion],
      `${pose.label} is returned by the shorter of the two runs: ${pose.expansion.slice(1).join(", ")}`,
    );
  }
});
