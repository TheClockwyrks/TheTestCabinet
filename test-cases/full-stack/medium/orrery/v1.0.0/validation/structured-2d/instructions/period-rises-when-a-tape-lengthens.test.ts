// instructions/period-rises-when-a-tape-lengthens — writing at or past the
// current period lengthens that tape, and the period rises with it.
//
// THE RULE, IN THREE SENTENCES THAT MEET. "A tape has no fixed end: writing past
// the last cell lengthens it, and the cells between hold blanks"
// (`specs/editor.md`, The tape panel), and the debug write says the same —
// "Cells between the tape's end and `col` become blanks"
// (`specs/instrumentation.md`). "A tape's length is the index of its last
// non-blank cell plus one" and "The machine's period `P` is the largest tape
// length across its arms and wheels" (`specs/instructions.md`). So an instruction
// written at column `col` makes that tape `col + 1` long, and when that is the
// largest length on the machine it is the period.
//
// THE CONFIGURATION. One challenge open, an empty machine, and two arms: the
// EDITED arm with a tape of length `2`, and a second arm with a tape of length
// `3` that is left alone from beginning to end. The second arm is why the point
// is about the period rising rather than about one tape growing — while the edited
// tape is the shorter of the two, the period is the other arm's `3`, and the
// write is what takes it over. Two anchors, both on the field, nothing else
// placed, and no run: the period is the editor's figure.
//
// THE TWO WRITES ARE THE TWO CASES THE ITEM NAMES, "at or past". The first lands
// at column `3`, which is exactly the period standing at the time, and lengthens
// the tape to `4`. The second lands at column `6`, two columns PAST the period
// then standing at `4`, and lengthens the same tape to `7` with blanks between —
// so a build that grew a tape by one column at a time, or refused a write beyond
// its end, is separated from one that lengthens to the column written.
//
// THE VERDICT. The machine starts at a period of `3`; a write at column `3` makes
// the edited tape `4` long and the period `4`; a write at column `6` makes it `7`
// long and the period `7`; and the untouched arm still carries the tape it began
// with.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertNotNull } from "../assert";
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

/** The edited arm, of length 2, and the bystander arm, of length 3. */
const MACHINE = solution([
  armPart("arm", 0, 0, 0, 1, ["grab", "drop"]),
  armPart("arm", 3, 0, 0, 1, ["rotate-cw", null, "rotate-ccw"]),
]);

/** The tape the bystander arm carries throughout. */
const BYSTANDER_TAPE = ["rotate-cw", null, "rotate-ccw"];

/** The period before either write: the bystander's 3. */
const BEFORE = 3;

/** The first write, at the column the period stands at, and the period it gives. */
const AT_THE_PERIOD = 3;
const RAISED = 4;

/** The second write, two columns past the period, and the period it gives. */
const PAST_THE_PERIOD = 6;
const RAISED_AGAIN = 7;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("lengthens the tape written past its end and raises the period to it", async () => {
  await openChallengeDocument(h, BARE);
  await h.debug.clearMachine();
  await loadMachine(h, MACHINE);
  const [edited = -1, bystander = -1] = await partIds(h);

  const posed = await h.snapshot();
  assertEqual(
    posed.editor.period,
    BEFORE,
    "before the writes the period is the longer, untouched tape's 3",
  );

  await h.debug.setTapeCell(edited, AT_THE_PERIOD, "grab");
  const first = await h.snapshot();
  assertEqual(
    partById(first, edited)?.tape?.length,
    RAISED,
    "an instruction written at column 3 makes that tape 4 long",
  );
  assertEqual(
    first.editor.period,
    RAISED,
    "the period rises to the lengthened tape's new length, 4",
  );

  await h.debug.setTapeCell(edited, PAST_THE_PERIOD, "drop");
  await h.advance(1);
  await captureStill(h, "raised");

  const second = await h.snapshot();
  const grown = partById(second, edited);
  assertNotNull(grown, "the edited arm is still on the machine");
  assertEqual(
    grown?.tape?.length,
    RAISED_AGAIN,
    "an instruction written at column 6, past the period, makes that tape 7 long",
  );
  assertDeepEqual(
    grown?.tape,
    ["grab", "drop", null, "grab", null, null, "drop"],
    "the cells between the tape's old end and the column written hold blanks",
  );
  assertEqual(
    second.editor.period,
    RAISED_AGAIN,
    "the period rises again, to the lengthened tape's new length, 7",
  );
  assertDeepEqual(
    partById(second, bystander)?.tape,
    BYSTANDER_TAPE,
    "the arm that was not written to carries the tape it began with",
  );
});
