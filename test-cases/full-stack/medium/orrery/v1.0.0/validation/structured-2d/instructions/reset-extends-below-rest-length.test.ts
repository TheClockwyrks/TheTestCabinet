// instructions/reset-extends-below-rest-length — the length run is one `extend`
// per step the walk stands below the rest length.
//
// THE RULE. `reset` writes, second, "`retract` repeated while the length is above
// the rest length, or `extend` repeated while it is below"
// (`specs/instructions.md`, `reset`). "Repeated while" is a count: `extend` is "A
// piston's length rises by one" (the instruction table), so returning a walk
// standing `n` steps below the rest length takes exactly `n` of them. The rest
// length is the placed one — "An arm's placed rotation and length are its rest
// pose" (`specs/parts.md`) — and length runs "from `ARM_MIN_LEN` (`1`) to
// `ARM_MAX_LEN` (`3`)", so the widest difference on this machine is two.
//
// THE CONFIGURATION, IN TWO POSES ON ONE PISTON. One challenge open in the
// editor, an empty machine, and one `piston` at `(0, 0)` placed at rotation `0`
// and rest length `ARM_MAX_LEN` (`3`), on no track — so the rotation run and the
// track run are both empty and the length run is the whole of the expansion after
// the `drop`. Its prefix is `retract` twice for the two-step pose and once for
// the one-step pose. Each pose is loaded onto a fresh machine, so no earlier
// expansion is in the tape the next walk reads. No run is started and the focus
// is posed to `tape`.
//
// WHY THE REST LENGTH IS `3` HERE. A walk can only stand below a rest length that
// is above the minimum, so the piston is placed at the top of the range and
// retracted down. That also makes the direction unmistakable: a build that wrote
// the length run the wrong way round would write `retract`s on a walk that is
// already as short as the range allows.
//
// THE VERDICT. Two steps below rest is answered `drop`, `extend`, `extend`; one
// step below is answered `drop`, `extend`; and the cells before the cursor stand
// as they were.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertNotNull } from "../assert";
import { ARM_MAX_LEN, type InstructionName } from "../constants";
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

/** The two poses: two steps below the rest length, and one. */
const POSES: readonly {
  label: string;
  prefix: readonly InstructionName[];
  expansion: readonly InstructionName[];
}[] = [
  {
    label: "a walk two steps below the rest length",
    prefix: ["retract", "retract"],
    expansion: ["drop", "extend", "extend"],
  },
  {
    label: "a walk one step below the rest length",
    prefix: ["retract"],
    expansion: ["drop", "extend"],
  },
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("writes one extend per step below the rest length", async () => {
  await openChallengeDocument(h, BARE);

  for (const pose of POSES) {
    await h.debug.clearMachine();
    await loadMachine(
      h,
      solution([
        armPart("piston", ORIGIN.q, ORIGIN.r, 0, ARM_MAX_LEN, [...pose.prefix]),
      ]),
    );
    const piston = (await partIds(h))[0] ?? -1;
    await h.debug.setFocus("tape");
    await h.debug.setCursor(piston, pose.prefix.length);
    await pressAction(h, "ins-reset");
    await captureStill(h, "extends");

    const written = partById(await h.snapshot(), piston)?.tape;
    assertNotNull(written, `the piston is on the machine after ${pose.label}`);
    assertDeepEqual(
      written,
      [...pose.prefix, ...pose.expansion],
      `${pose.label} is returned by ${pose.expansion.length - 1} extend(s), one per step of the difference`,
    );
  }
});
