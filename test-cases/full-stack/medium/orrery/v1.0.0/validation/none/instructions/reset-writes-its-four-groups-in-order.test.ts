// instructions/reset-writes-its-four-groups-in-order — drop, then the length run,
// then the rotation run, then the track run.
//
// THE RULE. "Invoked at a cell, `reset` writes, from that cell onward, the
// sequence that returns the arm from its pose at that cell to its rest pose, in
// this order: 1. `drop`, always, as the first instruction. 2. `retract` repeated
// while the length is above the rest length, or `extend` repeated while it is
// below. 3. `rotate-cw` or `rotate-ccw`, repeated, whichever direction reaches the
// rest rotation in fewer steps... 4. `advance` or `recede`, repeated, whichever
// direction reaches the rest cell in fewer steps along the track"
// (`specs/instructions.md`, `reset`). This item decides the ORDER those four
// groups are written in, and nothing else about any one of them.
//
// SO EACH GROUP IS POSED ONE INSTRUCTION LONG, AND THE FOUR ARE ALL DIFFERENT.
// Four cells then read as four groups, and a build that wrote them in any other
// arrangement — the rotation before the length, the track before the rotation,
// `drop` anywhere but first — reads back as a different sequence of the same four
// names. Nothing about which member of a pair is chosen is being decided here: the
// arm is off its rest pose in exactly one step of each of the three runs.
//
// THE CONFIGURATION. An open track of three cells, `(0, 0)` to `(2, 0)`, with a
// `piston` anchored on the path's first cell — mounted there, and the kind
// `specs/instructions.md` gives `extend` and `retract` to: "`extend` and `retract`
// belong to the `piston` alone". Its rest pose is rotation `0`, length `2`, cell
// `0`. Its tape carries `extend`, `rotate-cw`, `advance`, so the walk at column
// `3` stands at length `3`, rotation `1`, cell `1` — one step off its rest pose in
// each of the three. The returning runs are therefore one `retract`, one
// `rotate-ccw` (counterclockwise reaches rotation `0` from `1` in one step against
// the clockwise five), and one `recede`.
//
// THE VERDICT. From the cursor the tape reads `drop`, `retract`, `rotate-ccw`,
// `recede`, in that order, and the column after them is blank.

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

it("writes drop, the length run, the rotation run and the track run in that order", async () => {
  await openChallengeDocument(h, BARE);
  await loadMachine(
    h,
    solution([
      trackPart([at(0, 0), at(1, 0), at(2, 0)], false),
      armPart("piston", 0, 0, 0, 2, ["extend", "rotate-cw", "advance"]),
    ]),
  );
  const piston = (await partIds(h))[1] ?? -1;

  await h.debug.setFocus("tape");
  await h.debug.setCursor(piston, 3);
  await pressAction(h, "ins-reset");
  await captureStill(h, "ordered");

  const written = await h.snapshot();
  assertNotNull(
    partById(written, piston)?.tape,
    "the piston still carries a tape to have been written to",
  );
  assertDeepEqual(
    cellsAt(written, piston, 3, 4),
    ["drop", "retract", "rotate-ccw", "recede"],
    "drop is always first, then the length run, then the rotation run, then " +
      "the track run",
  );
  assertDeepEqual(
    cellsAt(written, piston, 7, 1),
    [null],
    "and the four groups are the whole expansion: nothing follows them",
  );
});
