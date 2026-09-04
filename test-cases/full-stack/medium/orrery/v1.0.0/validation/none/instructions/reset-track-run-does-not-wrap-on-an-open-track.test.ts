// instructions/reset-track-run-does-not-wrap-on-an-open-track — an open track's
// run is counted along the path, never through its ends.
//
// THE RULE. `reset`'s fourth group is "`advance` or `recede`, repeated, whichever
// direction reaches the rest cell in fewer steps along the track, wrapping counted
// on a closed track" (`specs/instructions.md`, `reset`) — so on an OPEN track
// there is no wrapping to count, and only the direction that walks along the path
// reaches the rest cell at all. The walk that put the arm off its rest cell reads
// the same way: "`advance` and `recede` step its track cell, wrapping only on a
// closed track and stopping at the end of an open one" (The two macros).
// `specs/parts.md` states it from the track's side: "on a closed track both wrap
// between the ends, and on an open track moving past either end faults".
//
// THE CONFIGURATION. An OPEN track of five cells in a line, `(-2, 0)` through
// `(2, 0)` — "A track is `closed` when its last cell is adjacent to its first and
// the editor has joined them into a loop ... otherwise it is open", and this one
// is never joined. One arm is anchored on the path's FIRST cell, `(-2, 0)`, so it
// is mounted there and its rest cell is cell `0`. Its tape carries four `advance`,
// which walks it to cell `4`, the path's last; the walk stops at that end rather
// than wrapping. Rest rotation and rest length are untouched by the prefix, so
// what follows `drop` is the track run alone.
//
// WHY THE TWO COUNTS CANNOT BE CONFUSED. Along the path, cell `0` is four `recede`
// back from cell `4`. Through a join the ring of five would put it one `advance`
// forward — but this track has no join, and a build that counted one anyway
// writes a single `advance` where the specification requires four `recede`.
//
// THE VERDICT. From the cursor the tape reads `drop` and then four `recede`, and
// the column after them is blank.

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

/** Five cells in a line, laid but never joined: an open path. */
const LINE = [at(-2, 0), at(-1, 0), at(0, 0), at(1, 0), at(2, 0)];

it("counts the run along an open path rather than through its ends", async () => {
  await openChallengeDocument(h, BARE);
  await loadMachine(
    h,
    solution([
      trackPart(LINE, false),
      armPart("arm", -2, 0, 0, 1, [
        "advance",
        "advance",
        "advance",
        "advance",
      ]),
    ]),
  );
  const arm = (await partIds(h))[1] ?? -1;

  await h.debug.setFocus("tape");
  await h.debug.setCursor(arm, 4);
  await pressAction(h, "ins-reset");
  await captureStill(h, "open-run");

  const written = await h.snapshot();
  assertNotNull(
    partById(written, arm)?.tape,
    "the arm still carries a tape to have been written to",
  );
  assertDeepEqual(
    cellsAt(written, arm, 4, 5),
    ["drop", "recede", "recede", "recede", "recede"],
    "reset writes drop and then the track run, and on an open track the only " +
      "way from cell 4 to cell 0 is four recede back along the path",
  );
  assertDeepEqual(
    cellsAt(written, arm, 9, 1),
    [null],
    "and nothing follows the fourth recede: no direction wrapped past an end",
  );
});
