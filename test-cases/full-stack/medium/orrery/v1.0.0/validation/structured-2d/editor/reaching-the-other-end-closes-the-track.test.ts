// editor/reaching-the-other-end-closes-the-track — moving onto the path's other
// end closes it into a loop.
//
// THE RULE. "While laying, moving the pointer onto a hex adjacent to the live end
// appends it to the path when the placement rules allow, and that hex becomes the
// live end; moving back onto the cell just behind the live end removes the end
// cell. Moving onto the path's other end closes the track into a loop and ends
// the lay" (`specs/editor.md`, Laying track). What "closed" means is placement
// rule 6 of `specs/parts.md`: "a closed track's last cell is adjacent to its
// first and its path holds at least three cells", and `specs/parts.md` again from
// the track's side: "A track is `closed` when its last cell is adjacent to its
// first and the editor has joined them into a loop".
//
// THE CONFIGURATION. `BARE` opened in the editor, the machine cleared, and one
// open track of exactly three cells posed through the surface: `(0, 0)`, `(1, 0)`,
// `(0, 1)`. Each consecutive pair differs by a `DIRS` offset — `(+1, 0)` then
// `(-1, +1)` — and the last cell differs from the first by `(0, +1)`, so the path
// is legal open and legal closed, and it is long enough for rule 6's "at least
// three cells". Nothing else is on the field, so nothing but this track can be
// what the pointer targets.
//
// The lay is opened by a press on the LAST cell, `(0, 1)`, which "begins laying
// rather than moving", and the pointer is then moved onto `(0, 0)` — the path's
// OTHER end. That hex is not the cell just behind the live end (that is `(1, 0)`),
// so the removal rule that outranks closing does not apply here.
//
// THE VERDICT. The track's `closed` flag is `true`, its path still holds the same
// three cells in the same order — closing joins the ends rather than appending
// one, and rule 3 forbids "one track twice" — and its last cell is adjacent to
// its first, which is what rule 6 requires of a closed track.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertNotNull,
  assertTrue,
} from "../assert";
import { adjacent, at, hexCenter, type Hex } from "../field";
import { BARE } from "../fixtures";
import {
  captureReplay,
  createHarness,
  moveTo,
  openChallengeDocument,
  partById,
  placeTrack,
  pressAt,
  releasePointer,
  type Harness,
} from "../harness";

/** The three cells laid, in order: consecutive pairs adjacent, last adjacent to first. */
const FIRST: Hex = at(0, 0);
const MIDDLE: Hex = at(1, 0);
const LAST: Hex = at(0, 1);

/** A path as a list of "q,r" names, so two paths compare without deep-equalling records. */
function pathOf(cells: readonly Hex[] | null): string[] {
  return (cells ?? []).map((cell) => `${cell.q},${cell.r}`);
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("closes the track into a loop when the lay reaches the path's other end", async () => {
  await openChallengeDocument(h, BARE);
  const track = await placeTrack(h, [FIRST, MIDDLE, LAST]);

  const before = partById(await h.snapshot(), track);
  assertNotNull(before, "the three-cell track is on the field before the lay");
  assertEqual(
    before?.closed,
    false,
    "the posed track is open, so the close is the lay's doing",
  );

  const seen = await captureReplay(h, "loop", async () => {
    await h.advance(1);
    await pressAt(h, hexCenter(LAST));
    const opened = (await h.snapshot()).editor.drag;
    await h.advance(1);
    await moveTo(h, hexCenter(FIRST));
    await h.advance(1);
    return { opened, after: partById(await h.snapshot(), track) };
  });
  await releasePointer(h);

  assertEqual(
    seen.opened?.kind,
    "lay",
    "the press on the track's last cell begins laying rather than moving, which is the lay the close ends",
  );

  assertNotNull(seen.after, "the track is still on the field after the close");
  assertEqual(
    seen.after?.closed,
    true,
    "moving onto the path's other end closes the track into a loop",
  );
  assertDeepEqual(
    pathOf(seen.after?.cells ?? null),
    pathOf([FIRST, MIDDLE, LAST]),
    "closing joins the ends rather than appending a cell: the path is the three cells it was laid with",
  );
  const laid = seen.after?.cells ?? [];
  const end = laid[laid.length - 1];
  const start = laid[0];
  assertTrue(
    end !== undefined && start !== undefined && adjacent(end, start),
    "the closed track's last cell is adjacent to its first, as placement rule 6 requires of a loop",
  );
});
