// instrumentation/open-challenge-empties-the-machine — `openChallenge` opens on an
// empty machine.
//
// THE RULE. "`openChallenge(mode, index)` — The open challenge becomes that
// mode's shipped challenge at `index`, and the game moves to the editor with an
// empty machine, empty histories, no run, and the tray derived from the
// challenge" (`specs/instrumentation.md`, The challenge). The snapshot carries
// the three as `editor.parts`, `editor.undoDepth` and `editor.redoDepth`, and
// `sim`, which is `null` "while editing".
//
// WHATEVER THE EDITOR HELD BEFORE THE CALL. `specs/editor.md` keeps a machine
// per challenge for the session — "leaving by any route keeps the machine, and
// every later visit in the session restores it exactly" — so a stash standing for
// the very challenge being opened is the case that tells "opens empty" apart from
// "opens on whatever was there". That is the challenge this check re-opens.
//
// THE CONFIGURATION. One Extras challenge, entered from code; two parts dragged
// out of its tray with the pointer, because "None [of the machine operations]
// pushes an undo entry, so `undoDepth` and `redoDepth` move under edits made
// through the pointer and the keys alone"; one `undo`, which moves an edit onto
// the redo side so BOTH depths are non-zero; and a live run started over what is
// left. The check reads all four of those back before the call, so what it is
// about is genuinely there to be cleared.
//
// THE VERDICT. After `openChallenge` on the same index, `editor.parts` is empty,
// `undoDepth` and `redoDepth` are `0`, and `sim` is `null`.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertGreaterThan,
  assertNotNull,
  assertNull,
} from "../assert";
import { at } from "../field";
import {
  captureStill,
  createHarness,
  dragFromTray,
  openChallenge,
  openTitle,
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

it("opens on an empty machine, empty histories and no run", async () => {
  await openTitle(h);
  await openChallenge(h, "extras", 0);

  // Tray entry 0 is the challenge's first permitted kind: "the challenge's
  // `permitted` part kinds, in the order of `PARTS`" come first (specs/editor.md).
  await dragFromTray(h, 0, at(0, 0));
  await dragFromTray(h, 0, at(2, 0));
  await pressAction(h, "undo");
  await h.debug.startRun();

  const before = await h.snapshot();
  assertGreaterThan(
    before.editor.parts.length,
    0,
    "the drags left a machine on the field to be cleared",
  );
  assertGreaterThan(
    before.editor.undoDepth,
    0,
    "the drags pushed undo entries, so there is a history to empty",
  );
  assertGreaterThan(
    before.editor.redoDepth,
    0,
    "the undo left an entry on the redo side, so there is one to empty too",
  );
  assertNotNull(before.sim, "the run is live, so there is a run to end");

  await openChallenge(h, "extras", 0);
  await captureStill(h, "empty");

  const opened = await h.snapshot();
  assertDeepEqual(
    opened.editor.parts,
    [],
    "openChallenge opens with an empty machine, whatever the editor held",
  );
  assertEqual(opened.editor.undoDepth, 0, "and with an empty undo history");
  assertEqual(opened.editor.redoDepth, 0, "and with an empty redo history");
  assertNull(opened.sim, "and with no run");
});
