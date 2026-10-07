// instructions/reset-track-run-wraps-on-a-closed-track — the track run counts
// through a closed track's join, so the shorter way may be the one that wraps.
//
// THE RULE. `reset` writes, fourth and last, "`advance` or `recede`, repeated,
// whichever direction reaches the rest cell in fewer steps along the track,
// wrapping counted on a closed track" (`specs/instructions.md`, `reset`). The walk
// that puts the arm off its rest cell counts the same way: "`advance` and `recede`
// step its track cell, wrapping only on a closed track and stopping at the end of
// an open one" (The two macros). `specs/parts.md` states the geometry both lean
// on: "on a closed track both wrap between the ends".
//
// THE CONFIGURATION. A CLOSED track of six cells — the ring around the origin, in
// `DIRS` order, so every consecutive pair is adjacent and the last cell is
// adjacent to the first, which is what `specs/parts.md` requires of a loop. One
// arm is anchored on the ring's cell `0`, `(1, 0)`, so it is mounted there ("An
// arm or wheel whose anchor hex is a cell of a track is mounted on that track")
// and its REST cell is cell `0`. Its tape carries four `advance`, so the walk at
// column `4` stands on cell `4`. Its rest rotation and rest length are untouched
// by the prefix, so the first three groups of the expansion contribute `drop`
// alone and what follows is the track run by itself.
//
// WHY FOUR CELLS FORWARD OF SIX. Counted through the join, `advance` reaches cell
// `0` from cell `4` in TWO steps and `recede` in four, so the shorter direction is
// the one that wraps. A build that counted along the path alone — which is the
// rule for an OPEN track, not this one — has only `recede` available and writes
// four of it, and the two answers cannot be confused for each other.
//
// THE VERDICT. From the cursor the tape reads `drop`, `advance`, `advance`, and
// the column after that is blank: the run wrapped, and it is two steps long.

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

it("writes the wrapping run when it is the shorter way round a closed track", async () => {
  await openChallengeDocument(h, BARE);
  await loadMachine(
    h,
    solution([
      trackPart(RING, true),
      armPart("arm", 1, 0, 0, 1, ["advance", "advance", "advance", "advance"]),
    ]),
  );
  const arm = (await partIds(h))[1] ?? -1;

  await h.debug.setFocus("tape");
  await h.debug.setCursor(arm, 4);
  await pressAction(h, "ins-reset");
  await captureStill(h, "wrapping-run");

  const written = await h.snapshot();
  assertNotNull(
    partById(written, arm)?.tape,
    "the arm still carries a tape to have been written to",
  );
  assertDeepEqual(
    cellsAt(written, arm, 4, 3),
    ["drop", "advance", "advance"],
    "reset writes drop and then the track run, and the shorter run from cell 4 " +
      "back to cell 0 of a six-cell closed track is two advance through the join",
  );
  assertDeepEqual(
    cellsAt(written, arm, 7, 1),
    [null],
    "and the run is two steps long, so the column after it is blank rather " +
      "than carrying the four recede an unwrapped count would have written",
  );
});
