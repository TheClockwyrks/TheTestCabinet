// instructions/reset-retracts-above-rest-length — the length run is one `retract`
// per step the walk stands above the rest length, and nothing where they agree.
//
// THE RULE. `reset` writes, second, "`retract` repeated while the length is above
// the rest length, or `extend` repeated while it is below"
// (`specs/instructions.md`, `reset`). "Repeated while" is a count: `retract` is
// "A piston's length falls by one" (the instruction table), so returning a walk
// standing `n` steps above the rest length takes exactly `n` of them, and `0`
// steps above takes none. The rest length is the placed one — "An arm's placed
// rotation and length are its rest pose" (`specs/parts.md`) — and length runs
// "from `ARM_MIN_LEN` (`1`) to `ARM_MAX_LEN` (`3`)", so the widest difference on
// this machine is two.
//
// THE CONFIGURATION, IN THREE POSES ON ONE PISTON. One challenge open in the
// editor, an empty machine, and one `piston` at `(0, 0)` placed at rotation `0`
// and rest length `ARM_MIN_LEN` (`1`), on no track — so the rotation run and the
// track run are both empty and the length run is the whole of the expansion after
// the `drop`. Its prefix is `extend` twice for the two-step pose, `extend` once
// for the one-step pose, and `extend` then `retract` for the pose that ENDS where
// it began. Each pose is loaded onto a fresh machine, so no earlier expansion is
// in the tape the next walk reads. No run is started and the focus is posed to
// `tape`.
//
// WHY THE THIRD POSE IS THERE. Two steps out and one step out separate a count
// from a constant; the agreeing pose is what separates a count from a build that
// writes at least one `retract` whenever the walk touched the length at all, and
// it is the "and none when the lengths already agree" the review item names. The
// walk in it visited length `2` on its way, so a build that read the highest
// length the walk reached rather than the length it ENDED at also fails it.
//
// THE VERDICT. Two steps above rest is answered `drop`, `retract`, `retract`; one
// step above is answered `drop`, `retract`; and a walk back at the rest length is
// answered `drop` alone.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertNotNull } from "../assert";
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

/** The three poses: two steps above rest, one step above, and level with it. */
const POSES: readonly {
  label: string;
  prefix: readonly InstructionName[];
  expansion: readonly InstructionName[];
}[] = [
  {
    label: "a walk two steps above the rest length",
    prefix: ["extend", "extend"],
    expansion: ["drop", "retract", "retract"],
  },
  {
    label: "a walk one step above the rest length",
    prefix: ["extend"],
    expansion: ["drop", "retract"],
  },
  {
    label: "a walk that lengthened and came back",
    prefix: ["extend", "retract"],
    expansion: ["drop"],
  },
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("writes one retract per step above the rest length, and none at it", async () => {
  await openChallengeDocument(h, BARE);

  for (const pose of POSES) {
    await h.debug.clearMachine();
    await loadMachine(
      h,
      solution([
        armPart("piston", ORIGIN.q, ORIGIN.r, 0, ARM_MIN_LEN, [...pose.prefix]),
      ]),
    );
    const piston = (await partIds(h))[0] ?? -1;
    await h.debug.setFocus("tape");
    await h.debug.setCursor(piston, pose.prefix.length);
    await pressAction(h, "ins-reset");
    await captureStill(h, "retracts");

    const written = partById(await h.snapshot(), piston)?.tape;
    assertNotNull(written, `the piston is on the machine after ${pose.label}`);
    assertDeepEqual(
      written,
      [...pose.prefix, ...pose.expansion],
      `${pose.label} is returned by ${pose.expansion.length - 1} retract(s), one per step of the difference`,
    );
  }
});
