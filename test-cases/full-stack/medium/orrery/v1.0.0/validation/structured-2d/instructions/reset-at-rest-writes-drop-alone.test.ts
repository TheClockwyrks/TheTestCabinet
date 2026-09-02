// instructions/reset-at-rest-writes-drop-alone — an arm the walk leaves at its
// rest pose receives one cell.
//
// THE RULE. "An arm already at rest writes `drop` alone"
// (`specs/instructions.md`, `reset`), which follows from the four groups above it:
// `drop` is written "always, as the first instruction", and each of the other
// three is a run "repeated" until the pose is reached — so each is empty when the
// pose is already there.
//
// AT REST MEANS THE WALK'S POSE, NOT AN EMPTY TAPE. "For `reset`, the arm's pose
// at a cell is the pose reached by executing cells `0` up to that cell once from
// the rest pose" (The two macros), so an arm at rest at the cursor is one whose
// prefix happens to have returned it, not one with nothing in front of the cursor.
// The prefix here is three cells long and does something at every one of them —
// `grab`, then a clockwise step, then the counterclockwise step that undoes it —
// and it leaves the walk exactly where it started: rotation `0`, length `1`, and
// no track under the arm to stand on a cell of.
//
// THE CONFIGURATION. One arm at the origin, at rotation `0` and length `1`, which
// is its rest pose, and nothing else on the machine. No track is laid, so the
// fourth group has nothing to count along whatever a build does with it; the item
// this suite decides is that the other two runs are empty and `drop` stands alone.
//
// THE VERDICT. The cursor's own cell holds `drop`, and the column after it is
// blank: one cell was written, not two, and not four.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertNotNull } from "../assert";
import type { InstructionName } from "../constants";
import { armPart, solution } from "../formats";
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

it("writes one cell, drop, when the walk stands at the arm's rest pose", async () => {
  await openChallengeDocument(h, BARE);
  await loadMachine(
    h,
    solution([armPart("arm", 0, 0, 0, 1, ["grab", "rotate-cw", "rotate-ccw"])]),
  );
  const arm = (await partIds(h))[0] ?? -1;

  await h.debug.setFocus("tape");
  await h.debug.setCursor(arm, 3);
  await pressAction(h, "ins-reset");
  await captureStill(h, "drop-alone");

  const written = await h.snapshot();
  assertNotNull(
    partById(written, arm)?.tape,
    "the arm still carries a tape to have been written to",
  );
  assertDeepEqual(
    cellsAt(written, arm, 3, 1),
    ["drop"],
    "drop is written always, as the first instruction of the expansion",
  );
  assertDeepEqual(
    cellsAt(written, arm, 4, 3),
    [null, null, null],
    "and the length, rotation and track runs are all empty on an arm the walk " +
      "left at its rest pose, so drop stands alone",
  );
});
