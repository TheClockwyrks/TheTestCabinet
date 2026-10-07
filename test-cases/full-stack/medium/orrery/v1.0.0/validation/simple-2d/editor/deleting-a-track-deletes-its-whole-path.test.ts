// editor/deleting-a-track-deletes-its-whole-path — one `part-delete` takes the
// whole track, not the pressed cell.
//
// THE RULE. "Deleting a track deletes its whole path" (`specs/editor.md`,
// Dragging), of the verb `specs/editor.md` names just above: "`part-delete`
// removes any part". A track is ONE part — "A `track` is an ordered path of
// distinct hexes, `cells`" (`specs/parts.md`) — so the thing the verb removes is
// the part, path and all, however many cells a press happened to land near.
// `specs/instrumentation.md` reports the machine as `editor.parts`, so a removed
// part is one that is no longer an entry there.
//
// THE CONFIGURATION. `BARE` opened in the editor, the machine cleared, and one
// open track of five cells posed through the surface, running east from `(-2, 0)`
// to `(2, 0)`, consecutive cells adjacent by `DIRS[0]`. Nothing else is on the
// field, so the machine is this track alone and what is left afterwards is
// unambiguous.
//
// The track is selected the player's way — a press on the INTERIOR cell `(0, 0)`,
// which "selects that part" and, being neither end of an open track, "begins a
// move" rather than a lay — and released on the hex it began on, which "commits no
// move". The release matters: while a drag is live the editor reads none of the
// four verbs but the ghost's, so `part-delete` must be pressed with the gesture
// over.
//
// THE VERDICT. `editor.parts` is empty. Not a shortened track, not a track with a
// hole in it, not four cells: the part is gone, and with it every cell of its
// path.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertNull } from "../assert";
import { at, hexCenter, type Hex } from "../field";
import { BARE } from "../fixtures";
import {
  captureStill,
  createHarness,
  openChallengeDocument,
  partById,
  placeTrack,
  pressAction,
  pressAt,
  releasePointer,
  type Harness,
} from "../harness";

/** A five-cell open path running east; `(0, 0)` is one of its three interior cells. */
const PATH: readonly Hex[] = [
  at(-2, 0),
  at(-1, 0),
  at(0, 0),
  at(1, 0),
  at(2, 0),
];
const PRESSED: Hex = at(0, 0);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("removes the whole track from editor.parts, not the pressed cell alone", async () => {
  await openChallengeDocument(h, BARE);
  const track = await placeTrack(h, PATH);
  assertLength(
    partById(await h.snapshot(), track)?.cells ?? [],
    5,
    "the track holds five cells before the delete, so a per-cell delete would leave four",
  );

  await pressAt(h, hexCenter(PRESSED));
  await releasePointer(h);
  const selected = await h.snapshot();
  assertEqual(
    selected.editor.selected,
    track,
    "the press selected the track, which is what part-delete removes",
  );
  assertNull(
    selected.editor.drag,
    "the gesture is over, so part-delete is an action the editor reads",
  );

  await pressAction(h, "part-delete");
  await h.advance(1);
  await captureStill(h, "gone");
  const after = await h.snapshot();

  assertNull(
    partById(after, track),
    "the track is no longer an entry of editor.parts",
  );
  assertLength(
    after.editor.parts,
    0,
    "one part-delete took the whole track: no shortened track is left behind",
  );
});
