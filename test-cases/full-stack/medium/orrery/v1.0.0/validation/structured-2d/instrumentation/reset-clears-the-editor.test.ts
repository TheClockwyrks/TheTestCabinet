// instrumentation/reset-clears-the-editor — reset closes the challenge, throws the
// machine away, and puts every editor field back to its resting value.
//
// THE RULE. "`reset()` — Restores every declared field of the game's state to its
// title-screen value: ... no challenge open, an empty editor with empty histories,
// no run ... `simTime` `0`" (`specs/instrumentation.md`, Session). What "an empty
// editor" comes to field by field is the same file's table of resting values:
// `challenge` is `null` "away from the editor"; `sim` is `null` "while editing"; and
// `editor` is "present always; empty `parts`, `cost` `0`, `period` `1`, `selected`
// and `cursor` `null`, `focus` `"field"`, `drag` `null`, both depths `0` when
// nothing is open". `specs/state.md` adds the guarantee behind it: "A reset leaves
// the game indistinguishable from a freshly started session."
//
// THE POSE MOVES ALL OF THEM OFF THEIR RESTING VALUES, which takes two kinds of
// call. The machine, the selection, the cursor and the focus are posed through the
// surface. The HISTORIES cannot be: "None [of the machine operations] pushes an undo
// entry, so `undoDepth` and `redoDepth` move under edits made through the pointer
// and the keys alone" — so the history is built by dragging the part across the
// field with the pointer, twice, and then pressing `undo` once, which leaves an
// entry on each side. A live drag is posed and read the same way, through the
// pointer, before the run starts. And the run is started, so `sim` has something to
// be cleared from.
//
// EVERY POSED FIELD IS READ BACK BEFORE THE RESET, so no reading below can pass by
// having never moved.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertNotNull,
  assertNull,
} from "../assert";
import { at, hexCenter } from "../field";
import { BARE, ORIGIN } from "../fixtures";
import {
  captureStill,
  createHarness,
  drag,
  openChallengeDocument,
  placePart,
  pressAction,
  pressAt,
  releasePointer,
  type Harness,
} from "../harness";

/** Two hexes the placed arm is dragged across, building a history of edits. */
const FIRST_MOVE = at(1, -1);
const SECOND_MOVE = at(2, -1);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("closes the challenge, empties the machine, and rests every editor field", async () => {
  await openChallengeDocument(h, BARE);
  const arm = await placePart(h, "arm", ORIGIN, 0);
  await h.debug.setTapeCell(arm, 0, "grab");
  await h.debug.setTapeCell(arm, 1, "rotate-cw");

  // The histories move under the pointer and the keys alone.
  await drag(h, hexCenter(ORIGIN), hexCenter(FIRST_MOVE));
  await drag(h, hexCenter(FIRST_MOVE), hexCenter(SECOND_MOVE));
  await pressAction(h, "undo");

  // A live drag, posed through the pointer and left open. It comes before the
  // focus is posed, because "a press anywhere else on the editor screen sets [the
  // focus] to `field`" (`specs/controls.md`).
  await pressAt(h, hexCenter(FIRST_MOVE));
  const dragging = await h.snapshot();
  assertNotNull(dragging.editor.drag, "a live drag is open on the field");
  await releasePointer(h);

  await h.debug.setSelected(arm);
  await h.debug.setCursor(arm, 0);
  await h.debug.setFocus("tape");

  await h.debug.startRun();
  await h.advance(2);

  const posed = await h.snapshot();
  assertNotNull(posed.challenge, "a challenge is open");
  assertNotNull(posed.sim, "a run is live");
  assertGreaterThan(posed.editor.parts.length, 0, "a machine is placed");
  assertGreaterThan(posed.editor.cost, 0, "which costs something");
  assertGreaterThan(posed.editor.period, 1, "and gives the machine a period");
  assertGreaterThan(posed.editor.undoDepth, 0, "with edits behind it");
  assertGreaterThan(
    posed.editor.redoDepth,
    0,
    "and an undone edit ahead of it",
  );
  assertNotNull(posed.editor.selected, "a part is selected");
  assertNotNull(posed.editor.cursor, "the tape cursor points somewhere");
  assertEqual(posed.editor.focus, "tape", "and the focus is on the tape");
  assertGreaterThan(posed.simTime, 0, "and frames have run");

  await h.debug.reset();
  const reset = await h.snapshot();
  await h.advance(1);
  await captureStill(h, "cleared");

  assertNull(reset.challenge, "reset leaves no challenge open");
  assertNull(reset.sim, "and no run");
  assertEqual(reset.editor.parts.length, 0, "the editor's machine is empty");
  assertEqual(reset.editor.cost, 0, "so its cost is 0");
  assertEqual(reset.editor.period, 1, "and its period is 1");
  assertEqual(reset.editor.undoDepth, 0, "both histories are empty");
  assertEqual(reset.editor.redoDepth, 0);
  assertNull(reset.editor.selected, "nothing is selected");
  assertNull(reset.editor.cursor, "the cursor points at nothing");
  assertEqual(reset.editor.focus, "field", "the focus rests on the field");
  assertNull(reset.editor.drag, "no drag is live");
  assertEqual(reset.simTime, 0, "and simTime is back to 0");
});
