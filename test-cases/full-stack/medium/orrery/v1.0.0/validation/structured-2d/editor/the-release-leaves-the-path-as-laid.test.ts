// editor/the-release-leaves-the-path-as-laid — the release ends the lay and
// changes nothing about the path.
//
// THE RULE. "The release ends the lay, leaving the path as laid"
// (`specs/editor.md`, Laying track), and, of every drag shape, "A drag ends at its
// release" (Dragging). `specs/instrumentation.md` reports the live drag as
// `editor.drag`, `null` when there is none, so "ends" is read there. "Leaving the
// path as laid" is the second half: the release is not a moment at which anything
// is decided about the path — it neither closes it nor trims it — so the cells
// after the release are exactly the cells the moves left.
//
// THE CONFIGURATION. `BARE` opened in the editor, the machine cleared, and a
// one-cell track posed on `(0, 0)`; nothing else is on the field. A press on that
// cell opens a lay from its `last` end, and two moves lay the path out: onto
// `(1, 0)`, adjacent by `DIRS[0]`, and then onto `(0, 1)`, adjacent to `(1, 0)` by
// `DIRS[2]`.
//
// THE PATH IS CHOSEN SO THAT CLOSING WOULD BE LEGAL. `(0, 1)` differs from
// `(0, 0)` by `DIRS[1]`, so the laid path's last cell IS adjacent to its first and
// it holds three cells — everything rule 6 of `specs/parts.md` asks of a closed
// track. Closing it is exactly what the editor does when the POINTER is moved onto
// the other end, and exactly what the release must not do.
//
// THE VERDICT. `editor.drag` is `null` after the release; the track holds the
// three cells the lay left, in the order it laid them; and `closed` is still
// `false` — the release neither joined the ends nor dropped a cell.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertNotNull,
  assertNull,
  assertTrue,
} from "../assert";
import { adjacent, at, hexCenter, type Hex } from "../field";
import { BARE } from "../fixtures";
import {
  captureStill,
  createHarness,
  moveTo,
  openChallengeDocument,
  partById,
  placeTrack,
  pressAt,
  releasePointer,
  type Harness,
} from "../harness";

/** The cell the track is posed on, and the two the lay adds. */
const START: Hex = at(0, 0);
const SECOND: Hex = at(1, 0);
const THIRD: Hex = at(0, 1);

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

it("ends the lay at the release and leaves the laid path untouched", async () => {
  await openChallengeDocument(h, BARE);
  const track = await placeTrack(h, [START]);

  await pressAt(h, hexCenter(START));
  await moveTo(h, hexCenter(SECOND));
  await moveTo(h, hexCenter(THIRD));

  const laid = partById(await h.snapshot(), track);

  await releasePointer(h);
  await h.advance(1);
  await captureStill(h, "laid");
  const after = await h.snapshot();

  assertNotNull(laid, "the track was on the field while the lay was live");
  assertDeepEqual(
    pathOf(laid?.cells ?? null),
    pathOf([START, SECOND, THIRD]),
    "the two moves laid a three-cell path, which is the path the release must leave",
  );
  const end = (laid?.cells ?? [])[(laid?.cells ?? []).length - 1];
  const first = (laid?.cells ?? [])[0];
  assertTrue(
    end !== undefined && first !== undefined && adjacent(end, first),
    "the laid path's last cell is adjacent to its first, so closing it would be legal and the release must still not close it",
  );

  assertNull(
    after.editor.drag,
    "a drag ends at its release, so no lay is live afterwards",
  );
  const path = partById(after, track);
  assertNotNull(path, "the track is still on the field after the release");
  assertDeepEqual(
    pathOf(path?.cells ?? null),
    pathOf([START, SECOND, THIRD]),
    "the track holds exactly the cells the lay left it with: the release trims nothing",
  );
  assertEqual(
    path?.closed,
    false,
    "the release leaves the path as laid, which is open, rather than closing it",
  );
});
