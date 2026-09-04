// instructions/reset-walk-ignores-poseless-cells — `grab`, `drop`, `pivot-cw` and
// `pivot-ccw` before the cursor move the walk not at all.
//
// THE RULE. "For `reset`, the arm's pose at a cell is the pose reached by
// executing cells `0` up to that cell once from the rest pose, ignoring faults
// and other parts: rotation steps its direction, `extend` and `retract` step its
// length, clamped to `ARM_MIN_LEN` (`1`) and `ARM_MAX_LEN` (`3`) rather than
// faulting, and `advance` and `recede` step its track cell"
// (`specs/instructions.md`, The two macros). That list is the whole of what a
// walk reads, and the other four instructions are outside it — which
// `specs/instructions.md`'s own table explains: `grab` and `drop` open and close
// grippers, and "`pivot-cw` | Each held constellation turns one 60 degree step
// clockwise about the gripper holding it", where "The part does not move"
// (`specs/simulation.md`, Motion and carrying). A walk carries no grip and no
// held constellation, so all four leave the three figures a `reset` has to undo —
// rotation, length, track cell — exactly where they stood.
//
// THE CONFIGURATION, IN TWO POSES ON ONE ARM. One challenge open in the editor,
// an empty machine, and one plain `arm` at `(0, 0)` placed at rotation `0` and
// length `1`, on no track. No run is started, the focus is posed to `tape`, and
// the cursor is posed at the column after the prefix, so the walk reads exactly
// the prefix.
//
// First a prefix of the four poseless cells ALONE — `grab`, `pivot-cw`, `drop`,
// `pivot-cw`, `pivot-ccw`, `grab` — whose pivots do not cancel, so a build that
// stepped the rotation on a pivot would stand one step clockwise of rest and
// would write a rotation run. The rule leaves the walk at rest, and "An arm
// already at rest writes `drop` alone".
//
// Then a prefix with one REAL rotation among them — `rotate-cw`, `grab`,
// `pivot-cw`, `drop`, `pivot-cw` — where the answer is a rotation run of exactly
// the one step that `rotate-cw` alone accounts for. That second pose is what
// separates the rule from a build whose walk never moves at all: such a build
// passes the first pose and fails this one, and a build that counted the two
// pivots would stand three steps out and write three.
//
// THE VERDICT. The poseless-only prefix is answered with `drop` alone; the prefix
// carrying one `rotate-cw` among the poseless cells is answered with `drop` and
// one `rotate-ccw`; and every cell before the cursor is left as it was.

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

/** The two prefixes, and the expansion each must be answered with. */
const POSES: readonly {
  label: string;
  prefix: readonly InstructionName[];
  expansion: readonly InstructionName[];
}[] = [
  {
    label: "a prefix of grabs, drops and pivots alone",
    prefix: ["grab", "pivot-cw", "drop", "pivot-cw", "pivot-ccw", "grab"],
    expansion: ["drop"],
  },
  {
    label: "one rotate-cw among the same poseless cells",
    prefix: ["rotate-cw", "grab", "pivot-cw", "drop", "pivot-cw"],
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

it("moves the walk's pose on no grab, drop or pivot", async () => {
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
    await captureStill(h, "poseless");

    const written = partById(await h.snapshot(), arm)?.tape;
    assertNotNull(written, `the arm is on the machine after ${pose.label}`);
    assertDeepEqual(
      written,
      [...pose.prefix, ...pose.expansion],
      `the walk read ${pose.label} and moved only on the rotation among them, so reset writes ${pose.expansion.join(", ")} from the cursor and leaves the cells before it alone`,
    );
  }
});
