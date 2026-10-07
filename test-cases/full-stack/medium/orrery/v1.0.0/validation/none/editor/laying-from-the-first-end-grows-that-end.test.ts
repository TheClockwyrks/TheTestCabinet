// editor/laying-from-the-first-end-grows-that-end — a lay opened at the `first`
// end grows the path at its front.
//
// THE RULE, in two sentences of `specs/editor.md` (Laying track). "A press on an
// end cell of an open track begins laying rather than moving" — and the shape
// `specs/instrumentation.md` reports for a lay carries which end it runs from:
// `{ kind: "lay", part, end: "first" | "last" }`. Then: "While laying, moving the
// pointer onto a hex adjacent to the live end appends it to the path when the
// placement rules allow, and that hex becomes the live end." The live end of a lay
// from `first` is the path's first cell, so the appended hex becomes the new first
// cell — the path grows at its front. Placement rule 6 of `specs/parts.md` is the
// legality that lets it: "A track's consecutive cells are adjacent."
//
// THE CONFIGURATION. `BARE` opened in the editor, the machine cleared, and one
// open two-cell track posed through the surface: `(0, 0)` then `(1, 0)`, adjacent
// by `DIRS[0]`. Nothing else is on the field. The press lands on `(0, 0)`, the
// FIRST cell, and the pointer is then moved onto `(-1, 0)` — adjacent to `(0, 0)`
// by `DIRS[3]`, on no cell of the path, and not the path's other end, so neither
// the removal rule nor the closing rule applies and the appending rule is what
// decides.
//
// THE VERDICT. The drag opened with `end` `first`, and afterwards the path reads
// `(-1, 0)`, `(0, 0)`, `(1, 0)`: the new hex is at the FRONT, ahead of the old
// first cell, the two cells that were already there keep their order, and every
// consecutive pair is adjacent.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertTrue } from "../assert";
import { RECORDING_RUN_UP, RECORDING_SETTLE } from "../constants";
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

/** The two cells posed, in order. */
const FIRST: Hex = at(0, 0);
const LAST: Hex = at(1, 0);

/** Adjacent to `FIRST` by `DIRS[3]`, on no cell of the path, and not its other end. */
const GROWN: Hex = at(-1, 0);

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

it("appends the hex in front of the old first cell when the lay runs from first", async () => {
  await openChallengeDocument(h, BARE);
  const track = await placeTrack(h, [FIRST, LAST]);

  const seen = await captureReplay(h, "front", async () => {
    await h.advance(RECORDING_RUN_UP);
    await pressAt(h, hexCenter(FIRST));
    const opened = (await h.snapshot()).editor.drag;
    await h.advance(1);
    await moveTo(h, hexCenter(GROWN));
    await h.advance(1);
    const grown = { opened, part: partById(await h.snapshot(), track) };
    await releasePointer(h);
    await h.advance(RECORDING_SETTLE);
    return grown;
  });

  assertEqual(
    seen.opened?.kind,
    "lay",
    "a press on an end cell of an open track begins laying rather than moving",
  );
  assertEqual(
    seen.opened?.kind === "lay" ? seen.opened.end : null,
    "first",
    "the press landed on the path's first cell, so the lay runs from its first end",
  );

  assertDeepEqual(
    pathOf(seen.part?.cells ?? null),
    pathOf([GROWN, FIRST, LAST]),
    "the appended hex joins the path in front of the old first cell, the rest keeping their order",
  );

  const path = seen.part?.cells ?? [];
  for (let i = 1; i < path.length; i += 1) {
    const before = path[i - 1];
    const after = path[i];
    assertTrue(
      before !== undefined && after !== undefined && adjacent(before, after),
      `the grown path's cells ${i - 1} and ${i} are adjacent, as placement rule 6 requires of consecutive cells`,
    );
  }
});
