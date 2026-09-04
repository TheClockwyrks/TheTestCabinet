// editor/right-has-no-upper-bound — `right` keeps carrying the cursor past the
// tape's last cell, because a tape has no last column.
//
// THE RULE. "`left` and `right` move it by one cell, stopping at `0` and moving
// without an upper bound" (`specs/editor.md`, The tape panel). The reason is the
// sentence that closes the same section: "A tape has no fixed end: writing past
// the last cell lengthens it, and the cells between hold blanks" — so there is no
// column for the cursor to stop at, and a cursor beyond the tape is a cursor
// waiting to lengthen it.
//
// THE CONFIGURATION. One arm carrying three cells, so the tape's length is `3`
// ("A tape's length is the index of its last non-blank cell plus one",
// `specs/instructions.md`) and its last cell stands at column `2`. That length is
// read back off the machine before the presses, so "the column of a tape's last
// cell" is measured rather than assumed. The cursor starts on that column, and
// five `right` presses follow it out past the end.
//
// THE VERDICT. `editor.cursor.col` reads `3`, `4`, `5`, `6` and `7` in turn,
// rising by one on every press, and the cursor stays on the arm's own row.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertNotNull } from "../assert";
import { armPart, solution } from "../formats";
import { BARE } from "../fixtures";
import {
  captureReplay,
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

it("keeps raising the column past the tape's last cell", async () => {
  await openChallengeDocument(h, BARE);
  await loadMachine(
    h,
    solution([armPart("arm", 0, 0, 0, 1, ["grab", "rotate-cw", "drop"])]),
  );
  const arm = (await partIds(h))[0] ?? -1;

  const before = await h.snapshot();
  const tape = partById(before, arm)?.tape;
  assertNotNull(tape, "the arm carries a tape whose last cell has a column");
  assertLength(
    tape ?? [],
    3,
    "the tape is three cells long, so its last cell stands at column 2",
  );

  await h.debug.setFocus("tape");
  await h.debug.setCursor(arm, 2);

  const walked = await captureReplay(h, "past-end", async () => {
    const seen: OrrerySnapshot[] = [];
    for (let press = 0; press < 5; press += 1) {
      seen.push(await pressAction(h, "right"));
    }
    return seen;
  });

  for (const [step, snapshot] of walked.entries()) {
    const cursor = snapshot.editor.cursor;
    assertNotNull(
      cursor,
      `the cursor still points at a cell after press ${step + 1}`,
    );
    assertEqual(
      cursor?.col,
      3 + step,
      "right moves without an upper bound, so each press raises the column by one",
    );
    assertEqual(
      cursor?.part,
      arm,
      "and the cursor stays on the row it is walking along",
    );
  }
});
