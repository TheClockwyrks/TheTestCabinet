// Refract — instrumentation/set-tier: `setTier` poses the run's tier alone.
//
// specs/instrumentation.md, `setTier(tier)`: "Sets `state.tier`, the tier the
// next cascade board is generated at, to `tier` ... and sets its own field
// alone. `state.solvedCount` is left as it is". The check poses a cascade
// board, reads the whole snapshot, sets the tier to 4, and holds the snapshot
// read back against the one it replaced with only `tier` changed. A build
// whose operation also rewrites the count to match the ladder, generates a
// board, or moves the screen fails on the field it touched.
//
// The two snapshots are read with no frame between them, because the pose
// acts on the live state at the call and a frame would move `simTime` and
// refresh the pointer on its own. The frame after the read is what draws the
// evidence. Only the documented fields are compared: a build may hold derived
// fields of its own beside them, and those are its to change.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import { GEO_3X3 } from "../fixtures";
import {
  captureStill,
  createHarness,
  loadBoard,
  resetTo,
  type Harness,
} from "../harness";
import { documented } from "./fields";

const POSED_TIER = 4;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("sets tier to 4 and leaves every other field as it was", async () => {
  await resetTo(h);
  h.debug.setMode("cascade");
  await loadBoard(h, GEO_3X3);
  const before = h.snapshot();
  assertEqual(
    before.screen,
    "playing",
    "precondition: a cascade board in play",
  );

  h.debug.setTier(POSED_TIER);
  const after = h.snapshot();
  await h.advance(1);
  captureStill(h, "posed");

  assertEqual(after.tier, POSED_TIER, "tier as posed");
  assertDeepEqual(
    documented(after),
    documented({ ...before, tier: POSED_TIER }),
    "every other documented field as it was (specs/instrumentation.md: " +
      "sets its own field alone)",
  );
});
