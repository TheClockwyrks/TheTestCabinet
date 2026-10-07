// editor/removal-outranks-closing-at-two-cells — a two-cell path is shortened
// rather than closed.
//
// THE RULE. "Removal outranks closing, so a path of two cells is shortened rather
// than closed" (`specs/editor.md`, Laying track), which decides the one case where
// the two rules above it name the same hex: "moving back onto the cell just behind
// the live end removes the end cell", and "moving onto the path's other end closes
// the track into a loop". On a path of exactly two cells the cell behind the live
// end IS the other end. Placement rule 6 of `specs/parts.md` agrees from the other
// side: a closed track's "path holds at least three cells", so two cells could not
// legally close in any case.
//
// THE CONFIGURATION. `BARE` opened in the editor, the machine cleared, and one
// open track of exactly two cells posed through the surface: `(0, 0)` and
// `(1, 0)`, which differ by `DIRS[0]` and so are adjacent. Nothing else is on the
// field. A press on the LAST cell `(1, 0)` opens the lay, and the pointer is moved
// onto `(0, 0)` — at once the cell just behind the live end and the path's other
// end.
//
// THE VERDICT. The end cell is gone: the track holds the single cell `(0, 0)` — "A
// track of one cell is legal and open" — and its `closed` flag is `false`. A build
// that closed instead would report two cells and `closed` `true`.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertNotNull } from "../assert";
import { RECORDING_RUN_UP, RECORDING_SETTLE } from "../constants";
import { at, hexCenter, type Hex } from "../field";
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

/** The two cells laid, in order: adjacent by `DIRS[0]`. */
const FIRST: Hex = at(0, 0);
const LAST: Hex = at(1, 0);

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

it("removes the end cell instead of closing when the path holds two cells", async () => {
  await openChallengeDocument(h, BARE);
  const track = await placeTrack(h, [FIRST, LAST]);

  const posed = partById(await h.snapshot(), track);
  assertNotNull(posed, "the two-cell track is on the field before the lay");
  assertDeepEqual(
    pathOf(posed?.cells ?? null),
    pathOf([FIRST, LAST]),
    "the lay starts from a path of exactly two cells, which is the case the rule decides",
  );

  const after = await captureReplay(h, "shortened", async () => {
    await h.advance(RECORDING_RUN_UP);
    await pressAt(h, hexCenter(LAST));
    const opened = (await h.snapshot()).editor.drag;
    await h.advance(1);
    await moveTo(h, hexCenter(FIRST));
    await h.advance(1);
    const shortened = { opened, part: partById(await h.snapshot(), track) };
    await releasePointer(h);
    await h.advance(RECORDING_SETTLE);
    return shortened;
  });

  assertEqual(
    after.opened?.kind,
    "lay",
    "the press on the track's last cell begins laying rather than moving",
  );
  assertNotNull(
    after.part,
    "the track is still on the field: one cell of it remains",
  );
  assertDeepEqual(
    pathOf(after.part?.cells ?? null),
    pathOf([FIRST]),
    "the end cell is removed, leaving the one cell the lay began from",
  );
  assertEqual(
    after.part?.closed,
    false,
    "removal outranks closing, so the track is left open rather than joined into a loop",
  );
});
