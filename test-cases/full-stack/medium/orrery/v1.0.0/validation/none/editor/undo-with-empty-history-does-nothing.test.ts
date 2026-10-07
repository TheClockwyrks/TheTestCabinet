// editor/undo-with-empty-history-does-nothing — with nothing on the undo side, the
// key is inert.
//
// THE RULE. `undo` and `redo` "both act only while editing and on the open
// challenge's machine alone, DO NOTHING WITH EMPTY HISTORY" (`specs/editor.md`,
// Undo and redo). `specs/instrumentation.md` reports what must not move:
// `editor.parts`, `editor.undoDepth` and `editor.redoDepth`.
//
// THE MACHINE IS STANDING, NOT EMPTY. An empty `editor.parts` would compare equal
// to an empty `editor.parts` however wrong the build was, so the scenario opens a
// challenge and then stands a machine on it — three parts with poses, a path and a
// tape between them, all of which an undo that fired would be free to disturb.
//
// THE HISTORY IS EMPTY BY THE SPECIFICATION'S OWN ROUTE, not by counting presses:
// "The open challenge becomes `challenge`... leaving the same editor state
// `openChallenge` leaves", which is "an empty machine, EMPTY HISTORIES, no run",
// and `loadSolution` "empties both histories and clears the selection, the cursor,
// and any live drag" (`specs/instrumentation.md`). Both depths are read as `0`
// before the press, so the press really is being made on an empty history.
//
// THE VERDICT. After the press `editor.parts` is exactly what it was, and both
// depths still read `0`.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertLength } from "../assert";
import { at } from "../field";
import { armPart, sigilPart, solution, trackPart } from "../formats";
import { BARE, ORIGIN } from "../fixtures";
import {
  captureStill,
  createHarness,
  loadMachine,
  openChallengeDocument,
  pressAction,
  type Harness,
} from "../harness";

/** A machine with a pose, a path and a tape between its parts. */
const BIND_AT = at(2, -2);
const MACHINE = solution([
  armPart("arm", ORIGIN.q, ORIGIN.r, 1, 2, ["grab", "rotate-cw"]),
  trackPart([at(-2, 2), at(-1, 2), at(0, 2)]),
  sigilPart("bind", BIND_AT.q, BIND_AT.r, 0),
]);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves the machine and both depths exactly as they stand", async () => {
  await openChallengeDocument(h, BARE);
  await loadMachine(h, MACHINE);

  const before = await h.snapshot();

  await pressAction(h, "undo");
  const after = await h.snapshot();

  await h.advance(1);
  await captureStill(h, "inert");

  assertLength(
    before.editor.parts,
    MACHINE.parts.length,
    "the machine stands with every part the scenario placed",
  );
  assertEqual(
    before.editor.undoDepth,
    0,
    "a freshly opened challenge leaves empty histories, so the undo side is empty",
  );
  assertEqual(before.editor.redoDepth, 0, "and so is the redo side");

  assertDeepEqual(
    after.editor.parts,
    before.editor.parts,
    "an undo with an empty history leaves editor.parts exactly as it stands",
  );
  assertEqual(
    after.editor.undoDepth,
    0,
    "and leaves editor.undoDepth exactly as it stands",
  );
  assertEqual(
    after.editor.redoDepth,
    0,
    "and puts nothing onto the redo side, because it took nothing off the undo side",
  );
});
