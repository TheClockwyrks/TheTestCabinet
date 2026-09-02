// editor/placing-a-part-pushes-one-entry — a place drag's release is ONE edit, and
// one `undo` takes the part back off the field.
//
// THE RULE. "Every committed edit to the machine pushes one entry onto the undo
// history: placing, moving, or deleting a part..." (`specs/editor.md`, Undo and
// redo). What the entry holds is the next sentence — "The entry holds the machine
// as it stood before the edit: the parts with their poses, paths, and tapes" — and
// what `undo` does with it the one after: "The `undo` action restores the machine
// from the latest entry". The snapshot carries the depth as `editor.undoDepth`
// (`specs/instrumentation.md`).
//
// WHAT THE PLACEMENT IS. "From the tray: the ghost is a new part at the targeted
// hex, at rotation `0` and length `1`. Releasing on a legal hex places it and
// selects it" (`specs/editor.md`, Dragging). So the edit is made the player's way,
// with the pointer, rather than through a surface operation — the machine
// operations "push no undo entry" by specification (`specs/instrumentation.md`),
// and an item about the history has to be driven through the editor.
//
// THE DEPTH IS READ AS A RISE, NOT AS A VALUE, and the undo is read on the
// MACHINE rather than on a part id: what `undo` restores is "the machine as it
// stood before the edit", and nothing fixes the ids a restored machine carries.
// Before the drag the field is empty, so afterwards it must be empty again.
//
// THE CONFIGURATION. The bare challenge, whose tray's first entry is its one
// permitted kind, `arm`; an empty machine; and one drag from that entry onto the
// hex at `(0, 0)`, which is legal for a lone arm.
//
// THE VERDICT. `editor.undoDepth` rises by exactly `1` as one arm appears at
// `(0, 0)`, and one `undo` leaves the machine empty again with the depth back
// where it started.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { BARE, ORIGIN } from "../fixtures";
import {
  captureReplay,
  createHarness,
  dragFromTray,
  openChallengeDocument,
  partsOfKind,
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

it("raises the depth by one on the release, and one undo takes the part off again", async () => {
  await openChallengeDocument(h, BARE);

  const before = await h.snapshot();
  assertLength(
    before.editor.parts,
    0,
    "the machine is empty, so the placement is the whole of what the undo has to take back",
  );
  const depth = before.editor.undoDepth;

  const placed = await captureReplay(h, "undone", async () => {
    await dragFromTray(h, 0, ORIGIN);
    await h.advance(1);
    const landed = await h.snapshot();
    await pressAction(h, "undo");
    await h.advance(1);
    return landed;
  });

  assertLength(
    placed.editor.parts,
    1,
    "the release on a legal hex placed the tray's part",
  );
  assertEqual(
    partsOfKind(placed, "arm")[0]?.q,
    ORIGIN.q,
    "the arm stands on the hex the drag was released over",
  );
  assertEqual(partsOfKind(placed, "arm")[0]?.r, ORIGIN.r, "on that hex's row");
  assertEqual(
    placed.editor.undoDepth,
    depth + 1,
    "placing a part pushes exactly one entry onto the undo history",
  );

  const undone = await h.snapshot();
  assertLength(
    undone.editor.parts,
    0,
    "one undo restores the machine as it stood before the placement, which was empty",
  );
  assertEqual(
    undone.editor.undoDepth,
    depth,
    "and the one entry the placement pushed is the one the undo took",
  );
});
