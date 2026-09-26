// editor/histories-are-not-stashed — the stash keeps the machine and drops both
// histories, so a second visit opens with nothing to undo.
//
// THE RULE. Undo and redo "reach back through THIS VISIT'S edits to the machine
// the visit began with; HISTORIES ARE NOT PART OF THE PER-CHALLENGE STASH"
// (`specs/editor.md`, Undo and redo). What the stash does keep is the other half
// of the reading: "leaving by any route keeps the machine, and every later visit
// in the session restores it exactly, tapes included" (Entering and leaving).
// `specs/instrumentation.md` reports both depths as `editor.undoDepth` and
// `editor.redoDepth`, and reports which challenges hold a stashed machine as
// `campaign.stashed`.
//
// THE CHALLENGE IS A SHIPPED ONE, because the stash is per challenge of a mode and
// `campaign.stashed` names its members by index. Campaign challenge `0` is "
// unlocked from the start" (`specs/modes/campaign.md`), so `confirm` on its row
// opens it: "`confirm` on an unlocked or solved challenge opens it in the editor".
//
// THE VISIT IS LEFT AND RE-ENTERED THE PLAYER'S WAY, through `back` — "`back`
// while editing returns to that select screen" — and `confirm` on the select
// screen, rather than through `openChallenge`, which by specification "moves to the
// editor with an empty machine, empty histories" and so would decide nothing about
// a stash at all.
//
// BOTH HISTORIES ARE NON-EMPTY WHEN THE VISIT ENDS. Two `part-cw` presses commit
// two edits and one `undo` moves one of them onto the redo side, so the visit is
// left with one entry on each side; a check that left only one side loaded could
// not tell "histories are not stashed" from "the redo side happened to be empty".
// The edits are made through the keys because `specs/instrumentation.md` says of
// the machine operations that "None pushes an undo entry".
//
// THE MACHINE IS COMPARED AS A SOLUTION DOCUMENT, which `readSolution` answers as
// "the current machine as a solution document, exactly what `loadSolution` would
// accept to rebuild it". That is the build's own report of the machine against
// itself, and it carries no part ids — which nothing in `specs/` requires a
// machine a STASH restores to keep. (The identity rule of Undo and redo is about
// a part an undo ENTRY restores, and a visit's histories do not survive it.)
//
// THE VERDICT. The second visit shows the same challenge with the machine the
// first visit left, and `editor.undoDepth` and `editor.redoDepth` both read `0`.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertContains,
  assertDeepEqual,
  assertEqual,
  assertGreaterThan,
} from "../assert";
import { ORIGIN } from "../fixtures";
import {
  captureStill,
  createHarness,
  openChallenge,
  partById,
  placePart,
  pressAction,
  readMachine,
  type Harness,
} from "../harness";

/** The shipped challenge the visit is made to: campaign row `0`, open from the start. */
const MODE = "campaign";
const INDEX = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("restores the machine on the second visit and opens both histories empty", async () => {
  await h.debug.setMode(MODE);
  await openChallenge(h, MODE, INDEX);

  const arm = await placePart(h, "arm", ORIGIN);
  await h.debug.setFocus("field");
  await h.debug.setSelected(arm);
  await pressAction(h, "part-cw");
  await pressAction(h, "part-cw");
  await pressAction(h, "undo");

  const leaving = await h.snapshot();
  const standing = await readMachine(h);

  await pressAction(h, "back");
  const away = await h.snapshot();

  await h.debug.setSelectIndex(INDEX);
  await pressAction(h, "confirm");
  const revisited = await h.snapshot();
  const restored = await readMachine(h);

  await h.advance(1);
  await captureStill(h, "empty");

  assertGreaterThan(
    leaving.campaign.count,
    INDEX,
    "the shipped course holds the challenge the visit is made to",
  );
  assertEqual(
    partById(leaving, arm)?.rotation,
    1,
    "the two turns and the one undo leave the arm one step clockwise of where it was placed",
  );
  assertEqual(
    leaving.editor.undoDepth,
    1,
    "the visit is left with one edit still on the undo side",
  );
  assertEqual(
    leaving.editor.redoDepth,
    1,
    "and one edit waiting on the redo side",
  );

  assertEqual(
    away.screen,
    "select",
    "back while editing returns to the select screen",
  );
  assertContains(
    away.campaign.stashed,
    INDEX,
    "leaving by any route keeps the machine, so the challenge holds a stashed one",
  );

  assertEqual(
    revisited.screen,
    "editor",
    "confirm on the row opens it in the editor",
  );
  assertEqual(
    revisited.challenge?.source,
    MODE,
    "and the challenge open is the shipped one the visit was made to",
  );
  assertEqual(
    revisited.challenge?.index,
    INDEX,
    "at the row the highlight sat on",
  );
  assertDeepEqual(
    restored,
    standing,
    "every later visit in the session restores the machine exactly, tapes included",
  );

  assertEqual(
    revisited.editor.undoDepth,
    0,
    "histories are not part of the per-challenge stash: the undo side opens empty",
  );
  assertEqual(revisited.editor.redoDepth, 0, "and so does the redo side");
});
