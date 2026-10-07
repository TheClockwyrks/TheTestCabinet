// Refract — instrumentation/snapshot-resting-values: fields of a mode not yet
// entered report their resting values rather than going missing.
//
// THE SHAPE IS FIXED WHATEVER THE MODE. `specs/instrumentation.md` gives the six
// mode fields — four Campaign's, two Cascade's — and a resting-values table a
// field reports until its mode is first entered in the session. A build that
// drops the other mode's fields, or reports them as whatever its internals
// happen to hold, breaks every reader that trusts the documented shape; a build
// that keeps them at their resting values is what the table requires. Each mode
// is entered from a clean progression (the harness opens on `reset`, and
// neither entry disturbs the other mode's fields), which is exactly the state
// the table describes; a field that has moved keeps its value, which
// campaign/campaign-progress-persists is the item to decide.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertHasProperty } from "../assert";
import {
  captureStill,
  createHarness,
  startCampaign,
  startCascade,
  type Harness,
} from "../harness";
import { SNAPSHOT_FIELDS } from "./fields";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("in Cascade, the campaign fields rest and no field goes missing", async () => {
  await startCascade(h);
  await captureStill(h, "resting");

  const snapshot = await h.snapshot();
  assertEqual(snapshot.mode, "cascade", "the sequence was entered");
  assertEqual(snapshot.screen, "playing", "cascade opens on playing");

  for (const field of SNAPSHOT_FIELDS) {
    assertHasProperty(snapshot, field, "no field goes missing in cascade");
  }

  // The resting-values table in specs/instrumentation.md, campaign's four.
  assertEqual(snapshot.boardIndex, 0, "boardIndex rests at 0");
  assertDeepEqual(snapshot.solvedBoards, [], "solvedBoards rests empty");
  assertEqual(snapshot.unlockedCount, 1, "unlockedCount rests at 1");
  assertEqual(snapshot.selectIndex, 0, "selectIndex rests at 0");
});

it("in Campaign, the cascade fields rest and no field goes missing", async () => {
  await startCampaign(h);

  const snapshot = await h.snapshot();
  assertEqual(snapshot.mode, "campaign", "the campaign was entered");
  assertEqual(snapshot.screen, "select", "campaign opens on select");

  for (const field of SNAPSHOT_FIELDS) {
    assertHasProperty(snapshot, field, "no field goes missing in campaign");
  }

  // The resting-values table in specs/instrumentation.md, cascade's two.
  assertEqual(snapshot.solvedCount, 0, "solvedCount rests at 0");
  assertEqual(snapshot.tier, 1, "tier rests at 1");
});
