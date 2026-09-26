// editor/the-history-has-no-bounded-depth — the history holds every edit of the
// visit, so forty of them are forty entries and forty undos reach the beginning.
//
// THE RULE. "The history holds every edit of the visit, with NO BOUND ON ITS
// DEPTH" (`specs/editor.md`, Undo and redo), and the paragraph below it says how
// far that reaches: undo and redo "reach back through this visit's edits to the
// machine the visit began with". `specs/instrumentation.md` reports the depth as
// `editor.undoDepth`.
//
// FORTY IS THE FIGURE THE ITEM NAMES, and it is well past any plausible ring
// buffer: a build holding the last ten, sixteen, or thirty-two edits reports a
// depth short of forty here, and its fortieth undo leaves parts on the field that
// the visit did not begin with.
//
// THE EDITS ARE PLACEMENTS, so the machine the visit began with is an EMPTY field
// and the count is visible in `editor.parts` as well as in the depth. "The open
// challenge becomes `challenge`... leaving the same editor state `openChallenge`
// leaves" — "an empty machine, empty histories, no run" — so the visit begins with
// nothing placed and nothing on either side of the history.
//
// EACH PLACEMENT IS A DRAG OUT OF THE TRAY, because `specs/instrumentation.md`
// says of the machine operations that "None pushes an undo entry, so `undoDepth`
// and `redoDepth` move under edits made through the pointer and the keys alone".
// "From the tray: the ghost is a new part at the targeted hex... Releasing on a
// legal hex places it and selects it" (`specs/editor.md`, Dragging).
//
// THE FORTY HEXES are the first forty of the field in reading order, taken from
// `specs/field.md`'s own extent rather than written out. They are distinct, so no
// two arms share an anchor (`specs/parts.md`, rule 4), and each is on the field,
// which is all rule 1 asks of "an arm or wheel's anchor" — so every one of the
// forty placements is legal and none is refused.
//
// THE VERDICT. `editor.undoDepth` reads exactly `40` after the forty drags, and
// after forty undos the field is empty again, the undo side is empty, and the
// forty edits are all waiting on the redo side.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { fieldHexes, type Hex } from "../field";
import { derivedTray } from "../formats";
import { BARE } from "../fixtures";
import {
  captureReplay,
  createHarness,
  dragFromTray,
  openChallengeDocument,
  pressAction,
  type Harness,
} from "../harness";

/** How many edits the visit makes, the figure the item names. */
const EDITS = 40;

/** The first forty hexes of the field, in reading order: forty distinct anchors. */
const ANCHORS: readonly Hex[] = fieldHexes().slice(0, EDITS);

/** The tray entry an arm is taken from (`specs/editor.md`, The tray). */
const ARM_SLOT = derivedTray(BARE).findIndex((entry) => entry.kind === "arm");

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("holds all forty edits, and forty undos reach the machine the visit began with", async () => {
  await openChallengeDocument(h, BARE);

  const began = await h.snapshot();
  assertLength(began.editor.parts, 0, "the visit begins with an empty field");
  assertEqual(began.editor.undoDepth, 0, "and an empty undo history");
  assertEqual(began.editor.redoDepth, 0, "and an empty redo side");
  assertEqual(
    ANCHORS.length,
    EDITS,
    "the field holds at least forty hexes to place forty arms on",
  );

  for (const anchor of ANCHORS) await dragFromTray(h, ARM_SLOT, anchor);
  const built = await h.snapshot();

  const undone = await captureReplay(h, "deep", async () => {
    for (let i = 0; i < EDITS; i += 1) await pressAction(h, "undo");
    return h.snapshot();
  });

  assertLength(
    built.editor.parts,
    EDITS,
    "all forty drags placed their arm, so there are forty committed edits",
  );
  assertEqual(
    built.editor.undoDepth,
    EDITS,
    "the history has no bound on its depth: forty edits leave a depth of forty",
  );

  assertLength(
    undone.editor.parts,
    0,
    "forty undos reach back through the visit's edits to the machine it began with",
  );
  assertEqual(undone.editor.undoDepth, 0, "and leave the undo side empty");
  assertEqual(
    undone.editor.redoDepth,
    EDITS,
    "with all forty edits moved onto the redo side",
  );
});
