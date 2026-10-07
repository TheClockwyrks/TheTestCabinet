// instructions/reset-walk-clamps-at-min-length — a `retract` in the walk with the
// length already at `ARM_MIN_LEN` leaves it at `1`.
//
// THE RULE. "`extend` and `retract` step its length, clamped to `ARM_MIN_LEN`
// (`1`) and `ARM_MAX_LEN` (`3`) rather than faulting" (`specs/instructions.md`,
// The two macros), against the bound `specs/parts.md` fixes: "Length is a whole
// number from `ARM_MIN_LEN` (`1`) to `ARM_MAX_LEN` (`3`)". "Rather than faulting"
// is the second half of the point: a run would raise `overretracted` here —
// "`retract` on a piston already at `ARM_MIN_LEN` (`1`)" (`specs/simulation.md`,
// Faults) — and the walk does not, so the expansion is written like any other.
//
// THE CONFIGURATION. One challenge open in the editor, an empty machine, and one
// `piston` at `(0, 0)` placed at rotation `0` and rest length `ARM_MAX_LEN`
// (`3`), carrying three `retract` cells. The cursor is posed at column `3`, so
// the walk reads all three: the first two carry the length from `3` down to `1`,
// and the THIRD is the one the rule is about — a `retract` with the walk already
// at `ARM_MIN_LEN`. No run is started, so the `retract` a run would refuse is
// never fetched by one; the focus is posed to `tape`.
//
// WHAT THE READINGS DISAGREE ON. Clamped, the walk stands at length `1` and the
// return run is `extend` twice, back to the rest length `3`. Unclamped it would
// stand at `0` and write three. A build that faulted or refused the macro leaves
// the tape three cells long. All three answers are different lengths of tape.
//
// THE VERDICT. The tape reads `retract`, `retract`, `retract`, `drop`, `extend`,
// `extend`: the third `retract` moved the walk nowhere, and the expansion was
// still written.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertNotNull } from "../assert";
import { ARM_MAX_LEN } from "../constants";
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

/** Two retracts reach ARM_MIN_LEN from the rest length; the third is the one at it. */
const PREFIX = ["retract", "retract", "retract"] as const;

/** The return run: one extend per step from ARM_MIN_LEN (1) back to 3. */
const EXPANSION = ["drop", "extend", "extend"] as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("holds the walk's length at 1 through a retract, and still writes the expansion", async () => {
  await openChallengeDocument(h, BARE);
  await h.debug.clearMachine();
  await loadMachine(
    h,
    solution([
      armPart("piston", ORIGIN.q, ORIGIN.r, 0, ARM_MAX_LEN, [...PREFIX]),
    ]),
  );
  const piston = (await partIds(h))[0] ?? -1;

  await h.debug.setFocus("tape");
  await h.debug.setCursor(piston, PREFIX.length);
  await pressAction(h, "ins-reset");
  await captureStill(h, "clamp-min");

  const written = partById(await h.snapshot(), piston)?.tape;
  assertNotNull(written, "the piston is still on the machine after the macro");
  assertDeepEqual(
    written,
    [...PREFIX, ...EXPANSION],
    "the third retract left the walk's length at ARM_MIN_LEN (1), so reset returns it to the rest length 3 in two extends rather than in three, and writes the expansion rather than faulting",
  );
});
