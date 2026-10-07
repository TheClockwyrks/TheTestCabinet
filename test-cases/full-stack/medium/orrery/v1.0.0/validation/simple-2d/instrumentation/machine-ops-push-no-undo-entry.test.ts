// instrumentation/machine-ops-push-no-undo-entry — nothing in the machine group
// pushes an undo entry.
//
// THE RULE. Of the whole machine group, "None pushes an undo entry, so
// `undoDepth` and `redoDepth` move under edits made through the pointer and the
// keys alone" (`specs/instrumentation.md`, The machine). The history the rule is
// about is `specs/editor.md`'s: "Every committed edit to the machine pushes one
// entry onto the undo history: placing, moving, or deleting a part, ending a lay
// that changed a track, rotating or resizing a part, and each write to a tape" —
// every one of which the machine group also does, through the surface instead. The
// snapshot reports both depths (`specs/instrumentation.md`, Snapshot shape), and
// their resting value is "both depths `0`".
//
// THE CONFIGURATION. A whole machine built through the group and nothing else: a
// clear, an arm, a rise, a set, a track laid and extended and closed, the arm
// turned, grown, moved and written to, a part removed, and finally the machine
// replaced by a document. Every one of those is an edit that would push an entry
// had it been made through the pointer or the keys. Both depths are read after
// every single call, so a build that pushed on one operation and not on the rest is
// caught on that operation.
//
// THE VERDICT. Every reading of both depths is `0`, and the machine really was
// built: the last placement stands the loaded document's parts up.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertGreaterThan } from "../assert";
import { at } from "../field";
import { EAST, IDLE_MACHINE, ORIGIN, WEST } from "../fixtures";
import { BARE } from "../fixtures";
import {
  captureStill,
  createHarness,
  loadMachine,
  openChallengeDocument,
  placePart,
  placeRise,
  placeSet,
  placeTrack,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves both histories empty however much of the machine group runs", async () => {
  await h.debug.reset();
  await openChallengeDocument(h, BARE);

  /** One reading of both depths, labelled by the operation that came before it. */
  const depths: [string, number, number][] = [];
  const read = async (after: string): Promise<void> => {
    const editor = (await h.snapshot()).editor;
    depths.push([after, editor.undoDepth, editor.redoDepth]);
  };

  await h.debug.clearMachine();
  await read("clearMachine");
  const arm = await placePart(h, "arm", ORIGIN, 0);
  await read("placePart");
  await placeRise(h, 0, WEST, 0);
  await read("placeRise");
  const set = await placeSet(h, 0, EAST, 0);
  await read("placeSet");
  const track = await placeTrack(h, [at(0, 3)]);
  await read("placeTrack");
  await h.debug.extendTrack(track, 1, 3);
  await read("extendTrack");
  await h.debug.extendTrack(track, 0, 4);
  await read("extendTrack again");
  await h.debug.closeTrack(track);
  await read("closeTrack");
  await h.debug.setPartRotation(arm, 2);
  await read("setPartRotation");
  await h.debug.setPartLength(arm, 2);
  await read("setPartLength");
  await h.debug.movePart(arm, 1, -1);
  await read("movePart");
  await h.debug.setTapeCell(arm, 0, "grab");
  await read("setTapeCell");
  await h.debug.removePart(set);
  await read("removePart");
  const built = await h.snapshot();
  await loadMachine(h, IDLE_MACHINE);
  await read("loadSolution");

  await h.advance(1);
  await captureStill(h, "depths");
  const loaded = await h.snapshot();

  assertGreaterThan(
    built.editor.parts.length,
    1,
    "the machine really was built through the group before it was replaced",
  );
  assertEqual(
    loaded.editor.parts.length,
    IDLE_MACHINE.parts.length,
    "the loaded document's parts stand, so every call in the sequence took effect",
  );
  assertDeepEqual(
    depths.filter(([, undo, redo]) => undo !== 0 || redo !== 0),
    [],
    "no machine operation moves undoDepth or redoDepth off 0",
  );
});
