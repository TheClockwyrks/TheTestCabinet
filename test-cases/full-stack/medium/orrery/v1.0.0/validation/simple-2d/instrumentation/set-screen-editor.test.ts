// instrumentation/set-screen-editor — `setScreen("editor")` returns to the open
// challenge and disturbs nothing.
//
// THE RULE. `specs/instrumentation.md`, Navigation and progress, in the table of
// what each name does: "`editor` | Shows the editor over the open challenge,
// leaving the machine, both histories, and any live run as they stand. With no
// challenge open it throws." The clause this check decides is the first one: what
// the call must leave alone. The throw is
// `instrumentation/set-screen-editor-throws-without-a-challenge`.
//
// THE CONFIGURATION. A posed challenge open in the editor; a machine built
// THROUGH THE POINTER rather than through the machine operations, because
// `specs/instrumentation.md` says none of those "pushes an undo entry, so
// `undoDepth` and `redoDepth` move under edits made through the pointer and the
// keys alone" — so a check about the histories has to make edits that have a
// history. Three arms are dragged out of the tray and one placement is then
// undone, so both depths are non-zero and different from each other, and one
// cannot be mistaken for the other.
//
// THE RUN IS DRIVEN OFF ITS REST POSE FIRST. One tape cell, `rotate-cw`, written
// with `setTapeCell` — which pushes no history, so the depths posed above stand —
// and one mote posed into the arm's hold. A whole cycle is then driven, so the
// run has a cycle count, a live rotation that differs from the part's rest
// rotation, and a grip that has ridden a motion. A call that quietly restarted the
// run, stopped it, or rebuilt the editor would lose one of those.
//
// THE VERDICT. After the call the screen is still `editor` over the same
// challenge, and every one of those figures reads exactly as it did before it: the
// machine part for part, both depths, and the run's status, cycle, fraction, live
// pose and grip.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertNear,
  assertNotEqual,
  assertNotNull,
} from "../assert";
import { FRACTION_TOLERANCE } from "../constants";
import { at } from "../field";
import { BARE } from "../fixtures";
import {
  advanceCycles,
  captureStill,
  createHarness,
  dragFromTray,
  heldBy,
  openChallengeDocument,
  partById,
  poseOf,
  pressAction,
  readMachine,
  spawnMote,
  takeGrip,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves the machine, both histories and the live run as they stand", async () => {
  await openChallengeDocument(h, BARE);
  await h.debug.clearMachine();

  // Three edits made the player's way, so the histories are not empty, and one
  // undone, so the two depths differ.
  await dragFromTray(h, 0, at(-2, 0));
  await dragFromTray(h, 0, at(0, -2));
  await dragFromTray(h, 0, at(2, 0));
  await pressAction(h, "undo");

  const edited = await h.snapshot();
  assertEqual(
    edited.editor.undoDepth,
    2,
    "two edits are left on the undo side",
  );
  assertEqual(edited.editor.redoDepth, 1, "one edit is left on the redo side");
  assertEqual(
    edited.editor.parts.length,
    2,
    "the undone placement is off the machine",
  );

  // The arm this check drives is found by the hex it was dropped on, so what
  // `editor.parts` is ordered by is another item's business.
  const arm =
    (await h.snapshot()).editor.parts.find(
      (part) => part.q === -2 && part.r === 0,
    )?.id ?? -1;
  await h.debug.setTapeCell(arm, 0, "rotate-cw");
  const machine = await readMachine(h);

  await h.debug.setCompletion(false);
  await h.debug.startRun();
  await h.debug.clearMotes();
  const carried = await spawnMote(h, at(-1, 0), "dust");
  await takeGrip(h, arm, 0, carried);
  await advanceCycles(h, 1);

  const before = await h.snapshot();
  assertNotNull(before.sim, "a run is live before the call");
  assertEqual(before.sim?.cycle, 1, "the run has a cycle behind it");
  assertNotEqual(
    poseOf(before, arm)?.rotation,
    partById(before, arm)?.rotation,
    "the run has carried the arm off its rest rotation",
  );

  await h.debug.setScreen("editor");
  const after = await h.snapshot();
  await h.advance(1);
  await captureStill(h, "editor");

  assertEqual(after.screen, "editor", 'setScreen("editor") shows the editor');
  assertEqual(
    after.challenge?.name,
    before.challenge?.name,
    "the same challenge is still the open one",
  );
  assertDeepEqual(
    await readMachine(h),
    machine,
    "the machine stands exactly as it was built",
  );
  assertEqual(after.editor.undoDepth, 2, "the undo history stands");
  assertEqual(after.editor.redoDepth, 1, "the redo history stands");

  assertNotNull(after.sim, "the live run stands");
  assertEqual(after.sim?.status, before.sim?.status, "the run's status stands");
  assertEqual(
    after.sim?.cycle,
    before.sim?.cycle,
    "the run's cycle count stands",
  );
  assertNear(
    after.sim?.fraction ?? -1,
    before.sim?.fraction ?? -2,
    FRACTION_TOLERANCE,
    "the run's fraction stands",
  );
  assertEqual(
    poseOf(after, arm)?.rotation,
    poseOf(before, arm)?.rotation,
    "the arm's live rotation stands",
  );
  assertEqual(
    heldBy(after, arm, poseOf(before, arm)?.rotation ?? -1),
    carried,
    "the gripper is still holding what it held",
  );
});
