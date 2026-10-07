// Refract — instrumentation/snapshot-resting-values: the shape is fixed
// whatever the mode. A field of a mode not yet entered in the session reports
// its resting value: in Cascade the campaign fields — boardIndex 0,
// solvedBoards empty, unlockedCount 1, selectIndex 0 — and in Campaign the
// cascade fields — solvedCount 0, tier 1. No field goes missing.
//
// Each mode holds live state of its own before its snapshot is read — the
// campaign really played to one solve, the cascade run posed through
// `setSolvedCount` and `setTier` and one posed board solved — so the fields
// under test are the other mode's while this one demonstrably moved. A fresh
// reset would make every field resting trivially; the item is that the fields
// of the mode never entered rest while the played mode's move. Neither check
// enters the other mode first: specs/instrumentation.md makes a field keep the
// value its mode last left it with, so a field that has moved stays moved, and
// campaign/campaign-progress-persists is the item that decides that. The
// resting values asserted are the table in specs/instrumentation.md.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertContains,
  assertDeepEqual,
  assertEqual,
  assertHasProperty,
} from "../assert";
import {
  captureStill,
  createHarness,
  driveCourse,
  poseCascadeRun,
  resetTo,
  solvePosedBoard,
  type Harness,
} from "../harness";
import { SNAPSHOT_FIELDS } from "./fields";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("in Cascade, the campaign fields report their resting values", async () => {
  // A run posed at one solve, and a posed board solved, so Cascade holds
  // progress of its own.
  await resetTo(h);
  poseCascadeRun(h, 1);
  await solvePosedBoard(h);
  await h.advance(1);
  const snap = h.snapshot();
  captureStill(h, "resting");

  assertEqual(snap.mode, "cascade", "the mode being played");
  assertEqual(snap.solvedCount, 2, "cascade really progressed");

  // The campaign four, at the resting values specs/instrumentation.md tables.
  assertEqual(snap.boardIndex, 0, "boardIndex rests at 0 in Cascade");
  assertDeepEqual(snap.solvedBoards, [], "solvedBoards rests empty in Cascade");
  assertEqual(snap.unlockedCount, 1, "unlockedCount rests at 1 in Cascade");
  assertEqual(snap.selectIndex, 0, "selectIndex rests at 0 in Cascade");

  // No field goes missing: the shape is fixed whatever the mode.
  for (const field of SNAPSHOT_FIELDS) {
    assertHasProperty(snap, field, "a documented field, present in Cascade");
  }
});

it("in Campaign, the cascade fields report their resting values", async () => {
  // Really solve campaign board 1, so Campaign holds progress of its own.
  await driveCourse(h, 1);
  const snap = h.snapshot();

  assertEqual(snap.mode, "campaign", "the mode being played");
  assertContains(snap.solvedBoards, 0, "campaign really progressed");

  // The cascade two, at the resting values specs/instrumentation.md tables.
  assertEqual(snap.solvedCount, 0, "solvedCount rests at 0 in Campaign");
  assertEqual(snap.tier, 1, "tier rests at 1 in Campaign");

  // No field goes missing: the shape is fixed whatever the mode.
  for (const field of SNAPSHOT_FIELDS) {
    assertHasProperty(snap, field, "a documented field, present in Campaign");
  }
});
