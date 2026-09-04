// instructions/period-one-when-every-tape-empty — a machine with nothing on any
// tape has a period of `1`, not of `0`.
//
// THE RULE. "The machine's period `P` is the largest tape length across its arms
// and wheels, and `1` when every tape is empty" (`specs/instructions.md`, Tapes
// and the period). A tape's length is "`0` when it is entirely blank", so the
// largest over a machine of blank tapes is `0` and the rule replaces it with `1`;
// a machine holding no arm and no wheel is the same maximum over nothing.
// `specs/instrumentation.md` writes the same figure down as `editor`'s resting
// value — "empty `parts`, `cost` `0`, `period` `1` ... when nothing is open".
//
// WHY `1` MATTERS RATHER THAN BEING A LABEL. The period is a divisor: "each part
// executes the cell at index `c` modulo `P` of its own tape"
// (`specs/instructions.md`). A period of `0` is not a number a cycle index can be
// taken modulo, so this is the rule that keeps the idle machine runnable.
//
// THE CONFIGURATION, IN THREE POSES. First a machine that HAS tape rows and
// nothing on them: two arms and a wheel, each placed with the empty tape
// `specs/formats.md` calls "an entirely blank tape". Then the same machine with
// one instruction written at column `2` of one arm and blanked again, so the
// figure is watched moving to `3` and back to `1` — without that step a build
// that reports `1` and nothing else would pass this point. Then a machine
// carrying NO arm and no wheel at all: a `bind` sigil and a three-cell track,
// which have no tapes and no rows. Anchors, footprint and cells are distinct hexes
// of the field, and no run is started, because the period is the editor's figure.
//
// THE VERDICT. Blank tapes report `1`; the written tape lifts the figure to `3`
// and blanking it puts it back to `1`; and a machine with no arm or wheel on it
// reports `1` as well.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull } from "../assert";
import { at } from "../field";
import { armPart, solution } from "../formats";
import { BARE } from "../fixtures";
import {
  captureStill,
  createHarness,
  loadMachine,
  openChallengeDocument,
  partById,
  partIds,
  placePart,
  placeTrack,
  type Harness,
} from "../harness";

/** Two arms and a wheel, each carrying the empty tape. */
const BLANK_MACHINE = solution([
  armPart("arm", 0, 0, 0, 1, []),
  armPart("arm", 2, 0, 0, 1, []),
  armPart("wheel", -2, 0, 0, 1, []),
]);

/** The column the one instruction is written at, and the length that gives. */
const COLUMN = 2;
const WRITTEN_PERIOD = 3;

/** A track with no tape and no row, laid clear of the sigil below. */
const TRACK_CELLS = [at(0, 3), at(1, 3), at(2, 3)];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** The machine's period, off a fresh snapshot. */
async function period(): Promise<number> {
  return (await h.snapshot()).editor.period;
}

it("reports a period of 1 with every tape empty and with no tape at all", async () => {
  await openChallengeDocument(h, BARE);
  await h.debug.clearMachine();
  await loadMachine(h, BLANK_MACHINE);
  const ids = await partIds(h);
  await h.advance(1);
  await captureStill(h, "period-one");

  const blank = await h.snapshot();
  for (const [index, id] of ids.entries()) {
    const part = partById(blank, id);
    assertNotNull(part, `the part placed ${index + 1}st is on the machine`);
    assertEqual(
      part?.tape?.length,
      0,
      `the part placed ${index + 1}st carries an entirely blank tape, of length 0`,
    );
  }
  assertEqual(
    blank.editor.period,
    1,
    "a machine whose arms and wheels all carry blank tapes has a period of 1",
  );

  // The figure is live rather than a constant: one instruction lifts it, and
  // blanking that cell puts it back.
  await h.debug.setTapeCell(ids[0] ?? -1, COLUMN, "grab");
  assertEqual(
    await period(),
    WRITTEN_PERIOD,
    "one instruction at column 2 gives that tape a length of 3, and the machine that period",
  );
  await h.debug.setTapeCell(ids[0] ?? -1, COLUMN, null);
  assertEqual(
    await period(),
    1,
    "blanking the one instruction empties every tape again, and the period is 1 once more",
  );

  // A machine with no arm and no wheel on it at all.
  await h.debug.clearMachine();
  await placePart(h, "bind", at(0, -3), 0);
  await placeTrack(h, TRACK_CELLS);
  await h.advance(1);
  const tapeless = await h.snapshot();
  assertEqual(
    tapeless.editor.parts.filter((part) => part.tape !== null).length,
    0,
    "a sigil and a track carry no tape, so the machine holds no arm and no wheel",
  );
  assertEqual(
    tapeless.editor.period,
    1,
    "a machine carrying no arm or wheel at all reports a period of 1",
  );
});
