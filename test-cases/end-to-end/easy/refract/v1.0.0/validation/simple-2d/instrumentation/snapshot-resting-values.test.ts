// Refract — instrumentation/snapshot-resting-values: fields the current mode
// does not use report their resting values rather than going missing.
//
// specs/instrumentation.md fixes the snapshot's shape whatever the mode is,
// and gives a field the current mode does not use a resting value: boardIndex
// 0, solvedBoards empty, unlockedCount 1, selectIndex 0, solvedCount 0, tier
// 1. So a snapshot read in Cascade still carries the four campaign fields, at
// rest, and one read in Campaign still carries the two cascade fields, at
// rest — and no field of the documented shape goes missing either way.
//
// Each check resets and enters one mode through the surface's own `startMode`
// — the pose specs/instrumentation.md gives for choosing a mode from the
// title, exactly as its menu item does — and reads the OTHER mode's fields
// against the resting-values table.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertHasProperty } from "../assert";
import {
  captureStill,
  createHarness,
  resetTo,
  type Harness,
  type RefractSnapshot,
} from "../harness";

/** Every field the documented snapshot shape lists (specs/instrumentation.md). */
const SNAPSHOT_FIELDS = [
  "version",
  "screen",
  "mode",
  "menuIndex",
  "boardIndex",
  "solvedBoards",
  "unlockedCount",
  "selectIndex",
  "solvedCount",
  "tier",
  "board",
  "beams",
  "solved",
  "tracing",
  "pointer",
  "muted",
  "simTime",
] as const;

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
  await resetTo(h, 1);
  h.debug.startMode("cascade");
  await h.advance(1);
  captureStill(h, "resting");

  const s = h.snapshot();
  assertEqual(s.mode, "cascade", "startMode('cascade') sets the mode");
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
  await resetTo(h, 1);
  h.debug.startMode("campaign");
  await h.advance(1);

  const s = h.snapshot();
  assertEqual(s.mode, "campaign", "startMode('campaign') sets the mode");
  assertEqual(
    s.screen,
    "select",
    "campaign opens on select (specs/modes/campaign.md)",
  );

  assertEqual(s.solvedCount, 0, "solvedCount rests at 0 in Campaign");
  assertEqual(s.tier, 1, "tier rests at 1 in Campaign");
  assertNoFieldMissing(s);
});
