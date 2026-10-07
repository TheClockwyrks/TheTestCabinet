// editor/releasing-on-the-starting-hex-commits-no-move — a move drag released on
// the hex it began on changes nothing and adds nothing to the history.
//
// THE RULE. "RELEASING ON THE STARTING HEX COMMITS NO MOVE; releasing elsewhere
// moves the part by the offset when the result is legal" (`specs/editor.md`,
// Dragging). What "commits" costs is the same file's Undo and redo section: "EVERY
// COMMITTED EDIT to the machine pushes one entry onto the undo history: placing,
// moving, or deleting a part... An edit that changes nothing... commits nothing
// and pushes no entry." So a release on the starting hex leaves both the part and
// `editor.undoDepth` where they were.
//
// THE CONFIGURATION. `BARE` opened in the editor, and the one arm on the field put
// there BY A TRAY DRAG rather than through the surface, because
// `specs/instrumentation.md` is explicit that the machine operations push no undo
// entry — "`undoDepth` and `redoDepth` move under edits made through the pointer
// and the keys alone". So the history holds exactly one entry before the gesture
// under test, and a build that keeps no history at all cannot pass this check by
// reporting `0` throughout. The gesture then presses `ORIGIN` and releases on
// `ORIGIN`: the same hex, no move onto another.
//
// THE VERDICT. The arm is still on `ORIGIN` at the pose it was placed at, and
// `editor.undoDepth` is the one entry the placement pushed, not two.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { ARM_MIN_LEN } from "../constants";
import { hexCenter } from "../field";
import { BARE, ORIGIN } from "../fixtures";
import {
  captureStill,
  createHarness,
  dragFromTray,
  openChallengeDocument,
  partById,
  partIds,
  pressAt,
  releasePointer,
  type Harness,
} from "../harness";

/** `BARE`'s tray: `arm`, then the one rise, then the one set. */
const ARM_SLOT = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves the part standing and pushes no second history entry", async () => {
  await openChallengeDocument(h, BARE);
  await dragFromTray(h, ARM_SLOT, ORIGIN);

  const placed = await h.snapshot();
  const ids = await partIds(h);
  assertEqual(
    ids.length,
    1,
    "the tray drag placed the one arm this check moves",
  );
  const arm = ids[0] as number;
  const depth = placed.editor.undoDepth;
  assertEqual(
    depth,
    1,
    "placing a part through the pointer pushed one entry, so the history is not empty",
  );

  await pressAt(h, hexCenter(ORIGIN));
  await releasePointer(h);
  await h.advance(1);
  await captureStill(h, "still");

  const after = await h.snapshot();
  const still = partById(after, arm);
  assertEqual(
    `${still?.q},${still?.r},${still?.rotation},${still?.length}`,
    `${ORIGIN.q},${ORIGIN.r},0,${ARM_MIN_LEN}`,
    "the arm stands exactly where and how it stood: the release committed no move",
  );
  assertEqual(
    after.editor.undoDepth,
    depth,
    "and the history is the one entry the placement pushed, the release having added none",
  );
});
