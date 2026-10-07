// instructions/empty-tape-length-zero — an entirely blank tape has length `0` and
// lengthens no period.
//
// THE RULE. "A tape's length is the index of its last non-blank cell plus one,
// and `0` when it is entirely blank. The machine's period `P` is the largest tape
// length across its arms and wheels, and `1` when every tape is empty"
// (`specs/instructions.md`, Tapes and the period). `specs/state.md` fixes how an
// empty one is reported: "Its length is trimmed: the last entry is never `null`,
// and an entirely blank tape is the empty array."
//
// THE CONFIGURATION, in two moments on one machine.
//
//   * First, two parts whose cells are all blank: an arm placed and never
//     written — "`placePart(kind, q, r, rotation)` — Places one part ... at
//     length `ARM_MIN_LEN` (`1`) with an empty tape"
//     (`specs/instrumentation.md`) — and a wheel written with one instruction and
//     then blanked back, so its blankness was reached by editing rather than by
//     never having been touched. Both report the empty list, and with every tape
//     on the machine empty the period is `1`.
//   * Then a third part, an arm carrying two instructions. Its tape's length is
//     `2`, and the period becomes `2`: the two blank tapes contributed `0` each,
//     rather than raising the largest length or being counted as tapes of one.
//
// Nothing runs. The requirement is a fact about a tape and about the period the
// editor reports.
//
// THE VERDICT. Both blank tapes read back as the empty list, the period over them
// alone is `1`, and adding a tape of length `2` makes the period `2`.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertNotNull } from "../assert";
import { BARE, NORTH, ORIGIN, SOUTH } from "../fixtures";
import {
  captureStill,
  createHarness,
  openChallengeDocument,
  partById,
  placePart,
  writeTape,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reports an entirely blank tape as the empty list and adds nothing to the period", async () => {
  await openChallengeDocument(h, BARE);
  const arm = await placePart(h, "arm", ORIGIN);
  const wheel = await placePart(h, "wheel", SOUTH);
  await writeTape(h, wheel, ["rotate-cw"]);
  await h.debug.setTapeCell(wheel, 0, null);

  await h.advance(1);
  await captureStill(h, "empty");

  const blank = await h.snapshot();
  assertNotNull(partById(blank, arm), "the arm is on the machine");
  assertDeepEqual(
    partById(blank, arm)?.tape,
    [],
    "an arm whose cells are all blank carries a tape of length 0, reported as the empty list",
  );
  assertNotNull(partById(blank, wheel), "the wheel is on the machine");
  assertDeepEqual(
    partById(blank, wheel)?.tape,
    [],
    "a wheel whose one written cell was blanked again carries a tape of length 0",
  );
  assertEqual(
    blank.editor.period,
    1,
    "the machine's period is 1 when every tape is empty",
  );

  const other = await placePart(h, "arm", NORTH);
  await writeTape(h, other, ["grab", "drop"]);

  const mixed = await h.snapshot();
  assertDeepEqual(
    partById(mixed, other)?.tape,
    ["grab", "drop"],
    "the third arm carries a tape of length 2",
  );
  assertEqual(
    mixed.editor.period,
    2,
    "the two blank tapes contribute 0 to the period, so the largest length across the machine is 2",
  );
});
