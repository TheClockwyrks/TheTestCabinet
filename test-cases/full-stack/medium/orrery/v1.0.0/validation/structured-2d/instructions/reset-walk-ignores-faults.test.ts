// instructions/reset-walk-ignores-faults — the walk steps a length a running arm
// could not, because the walk ignores faults.
//
// THE RULE. "For `reset`, the arm's pose at a cell is the pose reached by
// executing cells `0` up to that cell once from the rest pose, IGNORING FAULTS
// and other parts: ... `extend` and `retract` step its length, clamped to
// `ARM_MIN_LEN` (`1`) and `ARM_MAX_LEN` (`3`) rather than faulting"
// (`specs/instructions.md`, The two macros). What a RUN does with the same cell
// is the opposite: "`extend` and `retract` belong to the `piston` alone", and "an
// instruction the executing part cannot perform faults the run at the moment it
// is fetched" as `impossible` — "`extend` or `retract` on a part that is not a
// piston" (`specs/simulation.md`, Faults). The walk is not a run, so the cell
// steps the length like any other.
//
// THE CONFIGURATION, IN TWO POSES ON A PLAIN ARM. One challenge open in the
// editor, an empty machine, and one plain `arm` — not a `piston` — at `(0, 0)`
// placed at rotation `0` and rest length `ARM_MIN_LEN` (`1`), on no track. The
// first pose gives it ONE `extend` before the cursor, which is a cell its run
// would refuse; the second gives it FOUR, which is one more than the walk can
// take before `ARM_MAX_LEN` stops it, so the clamp the rule names in the same
// breath is exercised on the same unperformable cell. No run is started, so the
// fault is never raised at all; the focus is posed to `tape`.
//
// WHAT THE READINGS DISAGREE ON. Stepping the length, the first walk stands at
// `2` and is returned with one `retract`, and the second stands at `ARM_MAX_LEN`
// (`3`) and is returned with two. A build that skipped an `extend` it judged
// unperformable leaves the walk at the rest length and writes `drop` alone in
// both poses; a build that faulted or refused the macro writes nothing.
//
// THE VERDICT. One `extend` before the cursor is answered `drop`, `retract`; four
// are answered `drop`, `retract`, `retract`; and the cells before the cursor are
// left as they were.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertNotNull } from "../assert";
import { ARM_MIN_LEN, type InstructionName } from "../constants";
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

/** The two prefixes on the plain arm, and the run each must be answered with. */
const POSES: readonly {
  label: string;
  prefix: readonly InstructionName[];
  expansion: readonly InstructionName[];
}[] = [
  {
    label: "one extend, which the run would refuse",
    prefix: ["extend"],
    expansion: ["drop", "retract"],
  },
  {
    label: "four extends, one more than the walk can take",
    prefix: ["extend", "extend", "extend", "extend"],
    expansion: ["drop", "retract", "retract"],
  },
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("steps the walk's length on an extend a plain arm could not perform", async () => {
  await openChallengeDocument(h, BARE);

  for (const pose of POSES) {
    await h.debug.clearMachine();
    await loadMachine(
      h,
      solution([
        armPart("arm", ORIGIN.q, ORIGIN.r, 0, ARM_MIN_LEN, [...pose.prefix]),
      ]),
    );
    const arm = (await partIds(h))[0] ?? -1;
    const placed = partById(await h.snapshot(), arm);
    assertNotNull(placed, `the arm is on the machine for ${pose.label}`);
    assertEqual(
      placed?.kind,
      "arm",
      "the part carrying the extends is a plain arm, which extend and retract belong to the piston alone rather than to",
    );

    await h.debug.setFocus("tape");
    await h.debug.setCursor(arm, pose.prefix.length);
    await pressAction(h, "ins-reset");
    await captureStill(h, "walk-ignores-faults");

    assertDeepEqual(
      partById(await h.snapshot(), arm)?.tape,
      [...pose.prefix, ...pose.expansion],
      `with ${pose.label} the walk's length rose all the same, clamped at ARM_MAX_LEN (3), so reset returns the arm from the WALKED length rather than from its rest length`,
    );
  }
});
