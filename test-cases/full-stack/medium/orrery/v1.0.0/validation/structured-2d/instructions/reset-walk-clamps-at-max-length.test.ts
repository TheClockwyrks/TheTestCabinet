// instructions/reset-walk-clamps-at-max-length — an `extend` in the walk with the
// length already at `ARM_MAX_LEN` leaves it at `3`.
//
// THE RULE. "`extend` and `retract` step its length, clamped to `ARM_MIN_LEN`
// (`1`) and `ARM_MAX_LEN` (`3`) rather than faulting" (`specs/instructions.md`,
// The two macros). `specs/parts.md` fixes the bound the clamp is against: "Length
// is a whole number from `ARM_MIN_LEN` (`1`) to `ARM_MAX_LEN` (`3`)". The words
// "rather than faulting" are the second half of the point: the run would raise
// `overextended` here — "`extend` on a piston already at `ARM_MAX_LEN` (`3`)"
// (`specs/simulation.md`, Faults) — and the walk does not, so the expansion is
// written like any other.
//
// THE CONFIGURATION. One challenge open in the editor, an empty machine, and one
// `piston` at `(0, 0)` placed at rotation `0` and rest length `ARM_MIN_LEN`
// (`1`), carrying three `extend` cells. The cursor is posed at column `3`, so the
// walk reads all three: the first two carry the length from `1` to `3`, and the
// THIRD is the one the rule is about — an `extend` with the walk already at
// `ARM_MAX_LEN`. No run is started, so the `extend` the run would refuse is never
// fetched by one; the focus is posed to `tape`, which is the focus the tape verbs
// are read under.
//
// WHAT THE READINGS DISAGREE ON. Clamped, the walk stands at length `3` and the
// return run is `retract` twice, "one retract per step of the difference" back to
// the rest length `1`. Unclamped it would stand at `4` and write three. A build
// that faulted, refused the macro, or wrote nothing leaves the tape three cells
// long. All three answers are different lengths of tape.
//
// THE VERDICT. The tape reads `extend`, `extend`, `extend`, `drop`, `retract`,
// `retract`: the third `extend` moved the walk nowhere, and the expansion was
// still written.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertNotNull } from "../assert";
import { ARM_MIN_LEN } from "../constants";
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

/** Two extends reach ARM_MAX_LEN from the rest length; the third is the one at it. */
const PREFIX = ["extend", "extend", "extend"] as const;

/** The return run: one retract per step from ARM_MAX_LEN (3) back to 1. */
const EXPANSION = ["drop", "retract", "retract"] as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("holds the walk's length at 3 through an extend, and still writes the expansion", async () => {
  await openChallengeDocument(h, BARE);
  await h.debug.clearMachine();
  await loadMachine(
    h,
    solution([
      armPart("piston", ORIGIN.q, ORIGIN.r, 0, ARM_MIN_LEN, [...PREFIX]),
    ]),
  );
  const piston = (await partIds(h))[0] ?? -1;

  await h.debug.setFocus("tape");
  await h.debug.setCursor(piston, PREFIX.length);
  await pressAction(h, "ins-reset");
  await captureStill(h, "clamp-max");

  const written = partById(await h.snapshot(), piston)?.tape;
  assertNotNull(written, "the piston is still on the machine after the macro");
  assertDeepEqual(
    written,
    [...PREFIX, ...EXPANSION],
    "the third extend left the walk's length at ARM_MAX_LEN (3), so reset returns it to the rest length 1 in two retracts rather than in three, and writes the expansion rather than faulting",
  );
});
