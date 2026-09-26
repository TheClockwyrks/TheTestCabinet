// instrumentation/load-solution-clears-the-hands — a load empties both histories
// and puts down everything the editor was holding.
//
// THE RULE. "`loadSolution(solution)` | Replaces the open challenge's machine with
// `solution`... It empties both histories and clears the selection, the cursor,
// and any live drag" (`specs/instrumentation.md`, The machine). The snapshot
// carries all four: "`selected: <number | null>`", "`cursor: { part, col } |
// null`", "`drag: ... | null`", "`undoDepth: <number>`, `redoDepth: <number>`"
// (Snapshot shape). An emptied history is one nothing reaches back through:
// `undo` and `redo` "do nothing with empty history" (`specs/editor.md`).
//
// THE CONFIGURATION. Every one of the five is posed as something OTHER than its
// resting value first, so a build that never touched them would be caught: two
// arms placed by dragging them out of the tray, which is an edit made "through the
// pointer and the keys" and so pushes an undo entry apiece ("Every committed edit
// to the machine pushes one entry onto the undo history: placing... a part",
// `specs/editor.md`); one `undo` pressed, which "moves that edit onto the redo
// side", so both depths are non-zero at once; a selection and a tape cursor set
// through the surface; and a tray drag left LIVE — pressed on the tray's first
// entry and moved onto a hex, with no release — so `drag` is reported.
//
// THE VERDICT. After the load, both depths are `0`, `selected` and `cursor` are
// `null`, and `drag` is `null`. And the emptied history is genuinely empty: an
// `undo` pressed afterwards leaves the loaded machine exactly as the document
// stood it up, reaching nothing back past the load.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertNotNull,
  assertNull,
} from "../assert";
import { at, hexCenter, traySlot } from "../field";
import { BARE, IDLE_MACHINE } from "../fixtures";
import {
  captureStill,
  centerOf,
  createHarness,
  dragFromTray,
  loadMachine,
  moveTo,
  openChallengeDocument,
  partIds,
  pressAction,
  pressAt,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("empties both histories and clears the selection, the cursor and the drag", async () => {
  await h.debug.reset();
  await openChallengeDocument(h, BARE);

  // Two edits made the player's way, so the undo history has something in it,
  // then one undo, so the redo side does too.
  await dragFromTray(h, 0, at(-2, 0));
  await dragFromTray(h, 0, at(2, 0));
  await pressAction(h, "undo");

  // Both poses name the part the drags left standing, and
  // `specs/instrumentation.md` makes "a part or a mote no id names" invalid, so
  // each "fails loudly" on one. A build whose tray drags placed nothing has no
  // such id, so the arrangement is left un-posed rather than becoming this
  // point's failure; the readings below decide it either way, starting with the
  // undo history that placing nothing leaves empty.
  const placed = (await partIds(h))[0] ?? null;
  if (placed !== null) {
    await h.debug.setSelected(placed);
    await h.debug.setCursor(placed, 3);
  }

  // A tray drag left live: pressed on the first entry, moved onto a hex, unreleased.
  await pressAt(h, centerOf(traySlot(0)));
  await moveTo(h, hexCenter(at(0, 2)));
  const posed = await h.snapshot();

  await loadMachine(h, IDLE_MACHINE);
  await h.advance(1);
  await captureStill(h, "hands");
  const loaded = await h.snapshot();

  await pressAction(h, "undo");
  const afterUndo = await h.snapshot();

  assertGreaterThan(
    posed.editor.undoDepth,
    0,
    "the edits made through the pointer left an undo history to clear",
  );
  assertGreaterThan(
    posed.editor.redoDepth,
    0,
    "the undo pressed left a redo history to clear",
  );
  assertNotNull(
    posed.editor.selected,
    "a selection is posed before the load, so clearing it is observable",
  );
  assertNotNull(
    posed.editor.cursor,
    "a cursor is posed before the load, so clearing it is observable",
  );
  assertNotNull(
    posed.editor.drag,
    "a drag is live before the load, so clearing it is observable",
  );

  assertEqual(loaded.editor.undoDepth, 0, "the load empties the undo history");
  assertEqual(loaded.editor.redoDepth, 0, "the load empties the redo history");
  assertNull(loaded.editor.selected, "the load clears the selection");
  assertNull(loaded.editor.cursor, "the load clears the cursor");
  assertNull(loaded.editor.drag, "the load clears the live drag");

  assertEqual(
    afterUndo.editor.parts.length,
    IDLE_MACHINE.parts.length,
    "no undo reaches back past the load: the loaded machine stands",
  );
  assertEqual(
    afterUndo.editor.undoDepth,
    0,
    "an undo on an empty history does nothing, so the depth stays at 0",
  );
});
