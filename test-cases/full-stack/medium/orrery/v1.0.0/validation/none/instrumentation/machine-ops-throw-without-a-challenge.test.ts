// instrumentation/machine-ops-throw-without-a-challenge — every operation of the
// machine group refuses when no challenge is open.
//
// THE RULE. Of the whole machine group, "Five rules hold across the whole group:
// Each throws an `Error` with no challenge open" (`specs/instrumentation.md`, The
// machine). The group is the fourteen rows of that table: `clearMachine`,
// `placePart`, `placeRise`, `placeSet`, `placeTrack`, `extendTrack`, `closeTrack`,
// `removePart`, `setPartRotation`, `setPartLength`, `movePart`, `setTapeCell`,
// `loadSolution` and `readSolution`. And a refusal changes nothing: "An argument
// outside the domain its operation states is invalid, and the call fails loudly
// rather than guessing what was meant."
//
// THE CONFIGURATION. The state a `reset` leaves, which is the one state the
// specification names with no challenge open: "the title screen with its first
// menu item highlighted, `mode` `campaign`, no challenge open, an empty editor
// with empty histories, no run" (`specs/instrumentation.md`, Session). Every one
// of the fourteen is then called once, with arguments that would be ordinary on an
// open challenge, and each is expected to refuse before it looks at them.
//
// THE VERDICT. All fourteen throw. And the game is where the `reset` left it: no
// challenge open, an empty machine with both histories empty, no run, and the
// title screen still showing.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertNull } from "../assert";
import { EMPTY_MACHINE } from "../fixtures";
import { captureStill, createHarness, type Harness } from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("throws from every machine operation with no challenge open, and changes nothing", async () => {
  await h.debug.reset();
  await h.advance(1);
  await captureStill(h, "refused");
  const posed = await h.snapshot();

  const operations: [string, () => Promise<unknown>][] = [
    ["clearMachine", () => h.debug.clearMachine()],
    ["placePart", () => h.debug.placePart("arm", 0, 0, 0)],
    ["placeRise", () => h.debug.placeRise(0, 1, 0, 0)],
    ["placeSet", () => h.debug.placeSet(0, 2, 0, 0)],
    ["placeTrack", () => h.debug.placeTrack(0, 1)],
    ["extendTrack", () => h.debug.extendTrack(1, 1, 1)],
    ["closeTrack", () => h.debug.closeTrack(1)],
    ["removePart", () => h.debug.removePart(1)],
    ["setPartRotation", () => h.debug.setPartRotation(1, 2)],
    ["setPartLength", () => h.debug.setPartLength(1, 2)],
    ["movePart", () => h.debug.movePart(1, 1, 1)],
    ["setTapeCell", () => h.debug.setTapeCell(1, 0, "grab")],
    ["loadSolution", () => h.debug.loadSolution(EMPTY_MACHINE)],
    ["readSolution", () => h.debug.readSolution()],
  ];

  const returned: string[] = [];
  for (const [name, call] of operations) {
    try {
      await call();
      returned.push(name);
    } catch {
      // The refusal the rule requires.
    }
  }

  await h.advance(1);
  await captureStill(h, "refused");
  const after = await h.snapshot();

  assertNull(posed.challenge, "a reset leaves no challenge open");
  assertDeepEqual(
    returned,
    [],
    "every machine operation throws an Error with no challenge open",
  );
  assertNull(after.challenge, "the refusals opened no challenge");
  assertEqual(
    after.editor.parts.length,
    0,
    "the refusals placed nothing on the machine",
  );
  assertEqual(after.editor.undoDepth, 0, "the refusals pushed no undo entry");
  assertEqual(after.editor.redoDepth, 0, "the refusals pushed no redo entry");
  assertNull(after.sim, "the refusals started no run");
  assertEqual(
    after.screen,
    posed.screen,
    "the refusals left the game on the screen the reset put it on",
  );
});
