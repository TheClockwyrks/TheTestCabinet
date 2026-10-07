// instrumentation/snapshot-new-part-id — where a placing operation's answer is.
//
// THE RULE. `specs/instrumentation.md`, under the five rules holding across the
// whole machine group: "A new part's `id` is the `id` of the last entry of
// `editor.parts` in the next snapshot." None of the placing operations returns
// anything, so this sentence is the ONLY way a caller learns what it just placed,
// and every later call that names a part — `setPartRotation`, `setTapeCell`,
// `removePart`, and the readings over `sim` — names it by that `id`.
//
// THE CONFIGURATION. A posed challenge with one reagent and one product, an empty
// machine, and each of the four placing operations run in turn on hexes of its
// own: `placePart`, `placeRise`, `placeSet`, and `placeTrack`. After each, the
// last entry of `editor.parts` is read and checked to be the part just placed —
// its kind, and the anchor or cell it was given — rather than merely the last of a
// list that happened to grow.
//
// THEN THE ID IS USED. The arm's id is handed to `setPartRotation`, to
// `setTapeCell` and finally to `removePart`, and each time the part that changed
// is the one that was placed and no other: the machine that follows is exactly the
// three parts that were not addressed.
//
// THE VERDICT. Each placing operation leaves what it placed as the last entry, and
// the id read there is the id the rest of the surface answers to.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertLength,
  assertNotNull,
  assertNull,
} from "../assert";
import { at } from "../field";
import { BARE, EAST, ORIGIN, WEST } from "../fixtures";
import {
  captureStill,
  createHarness,
  lastPartId,
  openChallengeDocument,
  partById,
  partIds,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("makes the last entry of editor.parts the part just placed", async () => {
  await openChallengeDocument(h, BARE);
  await h.debug.clearMachine();

  await h.debug.placePart("arm", ORIGIN.q, ORIGIN.r, 0);
  const afterArm = await h.snapshot();
  await h.advance(1);
  await captureStill(h, "identified");
  const arm = lastPartId(afterArm);
  assertNotNull(
    arm,
    "placePart left a part for the next snapshot to report last",
  );
  assertLength(afterArm.editor.parts, 1, "one part is on the machine");
  assertEqual(
    partById(afterArm, arm ?? -1)?.kind,
    "arm",
    "the last entry is the arm placePart placed",
  );
  assertEqual(
    partById(afterArm, arm ?? -1)?.q,
    ORIGIN.q,
    "on the anchor it was given",
  );
  assertEqual(
    partById(afterArm, arm ?? -1)?.r,
    ORIGIN.r,
    "on the anchor it was given",
  );

  await h.debug.placeRise(0, WEST.q, WEST.r, 0);
  const afterRise = await h.snapshot();
  const rise = lastPartId(afterRise);
  assertEqual(
    partById(afterRise, rise ?? -1)?.kind,
    "rise",
    "the last entry is the rise placeRise placed",
  );
  assertEqual(
    partById(afterRise, rise ?? -1)?.index,
    0,
    "the rise is the one for the reagent it was asked for",
  );

  await h.debug.placeSet(0, EAST.q, EAST.r, 0);
  const afterSet = await h.snapshot();
  const set = lastPartId(afterSet);
  assertEqual(
    partById(afterSet, set ?? -1)?.kind,
    "set",
    "the last entry is the set placeSet placed",
  );
  assertEqual(
    partById(afterSet, set ?? -1)?.index,
    0,
    "the set is the one for the product it was asked for",
  );

  await h.debug.placeTrack(1, 2);
  const afterTrack = await h.snapshot();
  const track = lastPartId(afterTrack);
  assertEqual(
    partById(afterTrack, track ?? -1)?.kind,
    "track",
    "the last entry is the track placeTrack placed",
  );
  assertDeepEqual(
    partById(afterTrack, track ?? -1)?.cells,
    [at(1, 2)],
    "the track holds the one cell it was placed on",
  );
  assertDeepEqual(
    await partIds(h),
    [arm, rise, set, track],
    "the four ids are the four placements, in placement order",
  );

  // The id every later call names it by.
  await h.debug.setPartRotation(arm ?? -1, 3);
  await h.debug.setTapeCell(arm ?? -1, 0, "rotate-cw");

  const addressed = await h.snapshot();
  assertEqual(
    partById(addressed, arm ?? -1)?.rotation,
    3,
    "setPartRotation turned the part the placing operation's id names",
  );
  assertDeepEqual(
    partById(addressed, arm ?? -1)?.tape,
    ["rotate-cw"],
    "setTapeCell wrote to the tape of that same part",
  );
  assertEqual(
    partById(addressed, rise ?? -1)?.rotation,
    0,
    "no other part was touched by either call",
  );

  await h.debug.removePart(arm ?? -1);
  const removed = await h.snapshot();
  assertNull(
    partById(removed, arm ?? -1),
    "removePart took that part off the machine",
  );
  assertDeepEqual(
    await partIds(h),
    [rise, set, track],
    "the parts that were not addressed are exactly the ones that remain",
  );
});
