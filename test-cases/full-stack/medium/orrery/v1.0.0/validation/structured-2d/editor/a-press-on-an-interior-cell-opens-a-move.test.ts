// editor/a-press-on-an-interior-cell-opens-a-move — an interior cell of an open
// track opens a move drag.
//
// THE RULE. "A press on an end cell of an open track begins laying rather than
// moving" (`specs/editor.md`, Laying track) — an END cell, so a cell that is
// neither the path's first nor its last begins nothing of the sort, and what it
// begins instead is the general field gesture: "From the field: a press on a part
// selects it at once and begins a move" (`specs/editor.md`, Dragging).
//
// `specs/instrumentation.md` fixes the two shapes this tells apart: a move is
// `{ kind: "move", part: <part id>, from: { q, r }, at }` and a lay is
// `{ kind: "lay", part, end }`.
//
// THE CONFIGURATION. `BARE` opened in the editor, the machine cleared, and one
// OPEN track of three cells posed through the surface: `(-1, 0)`, `(0, 0)`,
// `(1, 0)`, consecutive cells adjacent by `DIRS[0]`. Three cells is the shortest
// path that has an interior at all, and its interior is exactly one cell,
// `(0, 0)`. Nothing else is on the field, so the press targets a cell of this
// track and takes this track.
//
// THE VERDICT. The press on `(0, 0)` opens a drag of kind `move` naming this
// track, and its `from` is the hex the press grabbed. Nothing was laid: the path
// still holds its three cells.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertNotNull } from "../assert";
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
  type Harness,
} from "../harness";

/** An open path of three cells, whose one interior cell is `(0, 0)`. */
const PATH: readonly Hex[] = [at(-1, 0), at(0, 0), at(1, 0)];
const INTERIOR: Hex = at(0, 0);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("opens a move drag when the pressed cell is neither the first nor the last", async () => {
  await openChallengeDocument(h, BARE);
  const track = await placeTrack(h, PATH);

  const posed = partById(await h.snapshot(), track);
  assertEqual(
    posed?.closed,
    false,
    "the posed track is open, so its end cells would have begun a lay",
  );
  assertLength(
    posed?.cells ?? [],
    3,
    "the path holds three cells, so (0, 0) is neither its first nor its last",
  );

  await pressAt(h, hexCenter(INTERIOR));
  await h.advance(1);
  await captureStill(h, "move");
  const after = await h.snapshot();
  const drag = after.editor.drag;
  await releasePointer(h);

  assertNotNull(drag, "the press on the interior cell opens a drag");
  assertEqual(
    drag?.kind,
    "move",
    "only an end cell begins laying, so a press on an interior cell opens a move",
  );
  assertEqual(
    drag?.kind === "move" ? drag.part : null,
    track,
    "the move names the track the pressed cell belongs to",
  );
  assertEqual(
    drag?.kind === "move" ? `${drag.from.q},${drag.from.r}` : null,
    `${INTERIOR.q},${INTERIOR.r}`,
    "the move grabbed the hex the press landed on",
  );
  assertLength(
    partById(after, track)?.cells ?? [],
    3,
    "nothing was laid: the path still holds the three cells it was posed with",
  );
});
