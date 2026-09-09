// Refract — instrumentation/snapshot-resting-values: fields of a mode not yet
// entered report their resting values rather than going missing.
//
// specs/instrumentation.md fixes the snapshot's shape whatever the mode is,
// and gives a field a resting value it reports until its mode is first entered
// in the session: boardIndex 0, solvedBoards empty, unlockedCount 1,
// selectIndex 0, solvedCount 0, tier 1. So a snapshot read in Cascade from a
// fresh reset still carries the four campaign fields, at rest, and one read in
// Campaign still carries the two cascade fields, at rest — and no field of the
// documented shape goes missing either way.
//
// Each check resets and enters one mode from the title, the way a player does,
// and reads the OTHER mode's fields against the resting-values table. Neither
// enters the other mode first: a field keeps the value its mode last left it
// with, which campaign/campaign-progress-persists is the item to decide.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertHasProperty } from "../assert";
import {
  captureStill,
  createHarness,
  resetTo,
  startCampaign,
  startCascade,
  type Harness,
  type RefractSnapshot,
} from "../harness";
import { SNAPSHOT_FIELDS } from "./fields";

/** The shape is fixed: every documented field is present, whatever the mode. */
function assertNoFieldMissing(s: RefractSnapshot): void {
  for (const field of SNAPSHOT_FIELDS) {
    assertHasProperty(s, field, "no field goes missing, whatever the mode");
  }
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("in Cascade, the campaign fields report their resting values", async () => {
  await resetTo(h);
  await startCascade(h);
  captureStill(h, "resting");

  const s = h.snapshot();
  assertEqual(s.mode, "cascade", "choosing CASCADE sets the mode");
  assertEqual(
    s.screen,
    "playing",
    "cascade opens on playing (specs/modes/cascade.md)",
  );

  assertEqual(s.boardIndex, 0, "boardIndex rests at 0 in Cascade");
  assertDeepEqual(s.solvedBoards, [], "solvedBoards rests empty in Cascade");
  assertEqual(s.unlockedCount, 1, "unlockedCount rests at 1 in Cascade");
  assertEqual(s.selectIndex, 0, "selectIndex rests at 0 in Cascade");
  assertNoFieldMissing(s);
});

it("in Campaign, the cascade fields report their resting values", async () => {
  await resetTo(h);
  await startCampaign(h);

  const s = h.snapshot();
  assertEqual(s.mode, "campaign", "choosing CAMPAIGN sets the mode");
  assertEqual(
    s.screen,
    "select",
    "campaign opens on select (specs/modes/campaign.md)",
  );

  assertEqual(s.solvedCount, 0, "solvedCount rests at 0 in Campaign");
  assertEqual(s.tier, 1, "tier rests at 1 in Campaign");
  assertNoFieldMissing(s);
});
