// instructions/reset-track-tie-is-advance — a track run that is the same length
// either way is written as `advance`.
//
// THE RULE. `reset`'s fourth group is "`advance` or `recede`, repeated, whichever
// direction reaches the rest cell in fewer steps along the track, wrapping counted
// on a closed track. A tie is written as `advance`" (`specs/instructions.md`,
// `reset`). This item is that last sentence: with neither direction shorter, the
// specification names which one is written rather than leaving it to the build.
//
// THE CONFIGURATION. A CLOSED track of six cells — the ring around the origin, in
// `DIRS` order, so consecutive cells are adjacent and the last is adjacent to the
// first, as `specs/parts.md` requires of a loop. One arm is anchored on the ring's
// cell `0`, `(1, 0)`, so it is mounted there and its rest cell is cell `0`. Its
// tape carries three `advance`, walking it to cell `3` — the cell diametrically
// opposite on a six-cell ring, from which the rest cell is three steps away
// through the join in EITHER direction. Rest rotation and rest length are
// untouched by the prefix, so what follows `drop` is the track run alone.
//
// A TIE IS ONLY A TIE ON A CLOSED TRACK, which is why the ring is the shape this
// item is posed on: on an open path exactly one direction reaches the rest cell,
// so the two counts can never come out equal.
//
// THE VERDICT. From the cursor the tape reads `drop` and then three `advance` —
// not three `recede` — and the column after them is blank.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertNotNull } from "../assert";
import type { InstructionName } from "../constants";
import { at } from "../field";
import { armPart, solution, trackPart } from "../formats";
import { BARE } from "../fixtures";
import {
  captureStill,
  createHarness,
  loadMachine,
  openChallengeDocument,
  partById,
  partIds,
  pressAction,
  type Harness,
  type OrrerySnapshot,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/**
 * The tape's columns `from` onward, as columns rather than as a trimmed list.
 *
 * "A cell at or past the tape's own length is blank" (`specs/instructions.md`),
 * and `specs/formats.md` trims a tape's trailing blanks away, so a column is read
 * as the cell it holds or as a blank.
 */
function cellsAt(
  snapshot: OrrerySnapshot,
  part: number,
  from: number,
  count: number,
): (InstructionName | null)[] {
  const tape = partById(snapshot, part)?.tape ?? [];
  return Array.from({ length: count }, (_unused, i) => tape[from + i] ?? null);
}

/** The ring around the origin, in `DIRS` order: six cells that close into a loop. */
const RING = [at(1, 0), at(0, 1), at(-1, 1), at(-1, 0), at(0, -1), at(1, -1)];

it("breaks a tied track run toward advance", async () => {
  await openChallengeDocument(h, BARE);
  await loadMachine(
    h,
    solution([
      trackPart(RING, true),
      armPart("arm", 1, 0, 0, 1, ["advance", "advance", "advance"]),
    ]),
  );
  const arm = (await partIds(h))[1] ?? -1;

  await h.debug.setFocus("tape");
  await h.debug.setCursor(arm, 3);
  await pressAction(h, "ins-reset");
  await captureStill(h, "tie-advance");

  const written = await h.snapshot();
  assertNotNull(
    partById(written, arm)?.tape,
    "the arm still carries a tape to have been written to",
  );
  assertDeepEqual(
    cellsAt(written, arm, 3, 4),
    ["drop", "advance", "advance", "advance"],
    "cell 3 of a six-cell closed track is three steps from cell 0 either way, " +
      "and a tie is written as advance",
  );
  assertDeepEqual(
    cellsAt(written, arm, 7, 1),
    [null],
    "and the run is the three steps the tie is long, with nothing after it",
  );
});
