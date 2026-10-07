// runs/back-returns-to-editing — `back` puts a live run away and hands the editor
// back to the player's hands.
//
// THE RULE. "`back` stops the run and returns to editing from any status, as
// `specs/simulation.md` states" (`specs/editor.md`, Running the machine), and
// `specs/simulation.md` says what stopping is: "Stopping a run, from the `back`
// action in any sim status, discards the motes and every runtime pose and returns
// to editing with the machine exactly as it was placed." What returning to
// editing means for the hands is the other half of the same section: "While a run
// is active, in any status, a press on the field or the tape panel sets the focus
// alone, and the editor reads the run controls above and `mute` and nothing
// else." So a press that did nothing but move the focus a moment ago must place,
// select and point again.
//
// THE CONFIGURATION. A run started on an EMPTY machine, so nothing on the field
// belongs to a previous edit and every part the check afterwards places is one it
// placed itself. `back` is pressed from `running` first and from `paused` second,
// because the item names both.
//
// THE VERDICT is `sim` reported as `null` on the editor screen with the challenge
// still open, and then the three interactive regions of `specs/editor.md`
// answering a pointer that reaches them exactly as a player's does: a drag out of
// tray entry `0` places an arm on the field, a press on a bare hex clears the
// selection and a press on the arm's hex selects it, and a press in the tape
// panel points the cursor at that arm's row and the column pressed.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertLength,
  assertNotNull,
  assertNull,
} from "../assert";
import { at, hexCenter, tapeCell } from "../field";
import { BARE, NORTH, ORIGIN } from "../fixtures";
import {
  backAction,
  captureStill,
  centerOf,
  clickAt,
  createHarness,
  dragFromTray,
  dragHex,
  lastPartId,
  openBareRun,
  type Harness,
} from "../harness";

/** The hex the arm placed after the run is dropped onto. */
const PLACED = at(1, 1);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("stops a running or paused run and gives the tray, the field and the tape panel back", async () => {
  /* -- back from `running` ----------------------------------------------- */

  await openBareRun(h, { challenge: BARE });

  const live = await h.snapshot();
  assertNotNull(live.sim, "a run is live before back is pressed");
  assertEqual(
    live.sim?.status,
    "running",
    "the run this back stops is running",
  );

  await backAction(h);
  await captureStill(h, "editing");

  const stopped = await h.snapshot();
  assertNull(stopped.sim, "back stops the run, so the snapshot reports no sim");
  assertEqual(stopped.screen, "editor", "back returns to editing");
  assertNotNull(
    stopped.challenge,
    "the challenge stays open: back stopped the run rather than leaving the editor",
  );

  // The tray answers the pointer: entry 0 of BARE's tray is its one permitted
  // kind, `arm` (`specs/editor.md`, The tray).
  await dragFromTray(h, 0, PLACED);
  const placed = await h.snapshot();
  assertLength(
    placed.editor.parts,
    1,
    "the drag out of the tray placed a part, so the tray answers the pointer again",
  );
  assertEqual(
    placed.editor.parts[0]?.kind,
    "arm",
    "tray entry 0 is the challenge's one permitted kind",
  );
  const arm = lastPartId(placed);
  assertNotNull(arm, "the placed arm has an id");

  // The field answers the pointer: a press on a bare hex clears the selection,
  // and a press on the arm selects it (`specs/editor.md`, Selection on the field).
  await clickAt(h, hexCenter(NORTH));
  assertNull(
    (await h.snapshot()).editor.selected,
    "a press on a bare hex clears the selection, so the field answers the pointer",
  );
  await clickAt(h, hexCenter(PLACED));
  assertEqual(
    (await h.snapshot()).editor.selected,
    arm,
    "a press on the arm's hex selects it",
  );

  // The tape panel answers the pointer: "A press inside a cell rectangle points
  // the cursor at that row's arm and that column" (`specs/editor.md`).
  await clickAt(h, centerOf(tapeCell(0, 3)));
  const pointed = await h.snapshot();
  assertEqual(
    pointed.editor.cursor?.part,
    arm,
    "the press in the tape panel points the cursor at the row's arm",
  );
  assertEqual(
    pointed.editor.cursor?.col,
    3,
    "the press points the cursor at the column it landed in",
  );
  assertEqual(
    pointed.editor.focus,
    "tape",
    "a press inside the tape panel's extent sets the focus to tape",
  );

  // And the field still moves parts: a drag from the field commits the move.
  await dragHex(h, PLACED, ORIGIN);
  const moved = await h.snapshot();
  assertEqual(
    moved.editor.parts[0]?.q,
    ORIGIN.q,
    "a drag on the field moves the part, so editing is fully back",
  );
  assertEqual(
    moved.editor.parts[0]?.r,
    ORIGIN.r,
    "the move landed on the target hex",
  );

  /* -- back from `paused` ------------------------------------------------ */

  await openBareRun(h, { challenge: BARE, paused: true });

  const held = await h.snapshot();
  assertEqual(
    held.sim?.status,
    "paused",
    "the second run this back stops is paused",
  );

  await backAction(h);

  const stoppedAgain = await h.snapshot();
  assertNull(
    stoppedAgain.sim,
    "back stops a paused run just as it stops a running one",
  );
  assertEqual(
    stoppedAgain.screen,
    "editor",
    "back from paused returns to editing",
  );
});
