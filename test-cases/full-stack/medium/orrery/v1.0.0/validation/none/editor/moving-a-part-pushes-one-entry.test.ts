// editor/moving-a-part-pushes-one-entry — a move drag's release is ONE edit, and
// one `undo` puts the part back on the hex it was pressed at.
//
// THE RULE. "Every committed edit to the machine pushes one entry onto the undo
// history: placing, moving, or deleting a part..." (`specs/editor.md`, Undo and
// redo). What the entry holds is the next sentence — "The entry holds the machine
// as it stood before the edit: the parts with their poses, paths, and tapes" — and
// what `undo` does with it the one after: "The `undo` action restores the machine
// from the latest entry". The snapshot carries the depth as `editor.undoDepth`
// (`specs/instrumentation.md`).
//
// WHAT THE MOVE IS. "From the field: a press on a part selects it at once and
// begins a move. The drag's offset is the targeted hex minus the pressed hex, and
// the whole part translates by it... Releasing on the starting hex commits no
// move; releasing elsewhere moves the part by the offset when the result is legal"
// (`specs/editor.md`, Dragging). So the edit is made the player's way, with the
// pointer, rather than through a surface operation — the machine operations "push
// no undo entry" by specification (`specs/instrumentation.md`).
//
// THE DEPTH IS READ AS A RISE, NOT AS A VALUE, and the undo is read on the
// MACHINE rather than on a part id: what `undo` restores is "the machine as it
// stood before the edit", and nothing fixes the ids a restored machine carries.
// One arm is on the field, so "the part" afterwards is the machine's one arm.
//
// THE CONFIGURATION. One arm anchored at `(0, 0)`, posed through the surface so
// the history begins where the drag finds it, and a drag from that hex to
// `(1, 0)`: an offset of one step east, legal for a lone arm.
//
// THE VERDICT. `editor.undoDepth` rises by exactly `1` as the arm's anchor reads
// `(1, 0)`, and one `undo` returns the arm to `(0, 0)` with the depth back where
// it started.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { at } from "../field";
import { BARE, ORIGIN } from "../fixtures";
import {
  captureReplay,
  createHarness,
  dragHex,
  openChallengeDocument,
  partsOfKind,
  placePart,
  pressAction,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** One step east of the anchor the arm is pressed at. */
const TARGET = at(1, 0);

it("raises the depth by one on the release, and one undo returns the part", async () => {
  await openChallengeDocument(h, BARE);
  await placePart(h, "arm", ORIGIN);

  const before = await h.snapshot();
  assertLength(
    before.editor.parts,
    1,
    "one arm stands on the field, so the move is the whole of what the undo has to take back",
  );
  assertEqual(
    partsOfKind(before, "arm")[0]?.q,
    ORIGIN.q,
    "the arm is anchored on the hex the drag will press",
  );
  const depth = before.editor.undoDepth;

  const moved = await captureReplay(h, "undone", async () => {
    await dragHex(h, ORIGIN, TARGET);
    await h.advance(1);
    const translated = await h.snapshot();
    await pressAction(h, "undo");
    await h.advance(1);
    return translated;
  });

  assertLength(
    moved.editor.parts,
    1,
    "the move edited the part rather than adding one",
  );
  assertEqual(
    `${partsOfKind(moved, "arm")[0]?.q},${partsOfKind(moved, "arm")[0]?.r}`,
    `${TARGET.q},${TARGET.r}`,
    "the release elsewhere moved the part by the drag's offset",
  );
  assertEqual(
    moved.editor.undoDepth,
    depth + 1,
    "moving a part pushes exactly one entry onto the undo history",
  );

  const undone = await h.snapshot();
  assertLength(
    undone.editor.parts,
    1,
    "the arm is still on the field after the undo",
  );
  assertEqual(
    `${partsOfKind(undone, "arm")[0]?.q},${partsOfKind(undone, "arm")[0]?.r}`,
    `${ORIGIN.q},${ORIGIN.r}`,
    "one undo returns the part to the anchor it was pressed at",
  );
  assertEqual(
    undone.editor.undoDepth,
    depth,
    "and the one entry the move pushed is the one the undo took",
  );
});
