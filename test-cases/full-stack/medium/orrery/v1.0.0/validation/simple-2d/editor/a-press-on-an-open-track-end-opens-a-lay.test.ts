// editor/a-press-on-an-open-track-end-opens-a-lay — pressing either end cell of an
// open track opens a lay, not a move, and the drag names which end was pressed.
//
// THE RULE. "A PRESS ON AN END CELL OF AN OPEN TRACK BEGINS LAYING RATHER THAN
// MOVING" (`specs/editor.md`, Laying track). `specs/instrumentation.md` fixes what
// the snapshot then reports: a drag of `kind: "lay"`, with `part` the track's id
// and `end` one of `"first"` and `"last"`. Which cells those are is
// `specs/parts.md`: "A `track` is an ordered path of distinct hexes, `cells`",
// whose ends are therefore the first and last entries of that path.
//
// THE CONFIGURATION. `BARE` opened in the editor with ONE track, `(-1, 0)`,
// `(0, 0)`, `(1, 0)`, laid through the surface, and nothing else on the field —
// so the hex a press targets can only reach this track, and the topmost rule that
// decides between an arm, a track and a sigil on one hex never comes into it.
// Three cells means each end is distinct from the other and from the middle.
// Each press is released before the next, and no pointer move happens in between,
// so no cell is appended, removed, or joined: "The release ends the lay, leaving
// the path as laid."
//
// THE VERDICT. The press on `(1, 0)` opens a `lay` naming the track with `end`
// `"last"`, and the press on `(-1, 0)` opens one with `end` `"first"`.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import { at, hexCenter, type Hex } from "../field";
import { BARE } from "../fixtures";
import {
  captureStill,
  createHarness,
  openChallengeDocument,
  partById,
  placeTrack,
  pressAt,
  releasePointer,
  type DragView,
  type Harness,
} from "../harness";

/** A three-cell open path running east: two distinct ends and a middle. */
const PATH: readonly Hex[] = [at(-1, 0), at(0, 0), at(1, 0)];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** The drag a press on `cell` opens, read and then released on the same hex. */
async function pressCell(cell: Hex): Promise<DragView | null> {
  await pressAt(h, hexCenter(cell));
  const drag = (await h.snapshot()).editor.drag;
  await releasePointer(h);
  return drag;
}

it("opens a lay naming the track and the end that was pressed", async () => {
  await openChallengeDocument(h, BARE);
  const track = await placeTrack(h, PATH);

  await pressAt(h, hexCenter(PATH[PATH.length - 1] as Hex));
  await h.advance(1);
  await captureStill(h, "lay");
  const onLast = (await h.snapshot()).editor.drag;
  await releasePointer(h);

  const onFirst = await pressCell(PATH[0] as Hex);

  assertEqual(
    onLast?.kind,
    "lay",
    "a press on the path's last cell begins a lay",
  );
  assertEqual(
    onLast?.kind === "lay" ? onLast.part : null,
    track,
    "and the lay names the track that cell belongs to",
  );
  assertEqual(
    onLast?.kind === "lay" ? onLast.end : null,
    "last",
    "and reports the end that was pressed",
  );

  assertEqual(
    onFirst?.kind,
    "lay",
    "a press on the path's first cell begins a lay too",
  );
  assertEqual(
    onFirst?.kind === "lay" ? onFirst.end : null,
    "first",
    "and that one reports the other end",
  );

  assertDeepEqual(
    (partById(await h.snapshot(), track)?.cells ?? []).map(
      (cell) => `${cell.q},${cell.r}`,
    ),
    PATH.map((cell) => `${cell.q},${cell.r}`),
    "neither press moved the pointer, so the path is the path that was laid",
  );
});
