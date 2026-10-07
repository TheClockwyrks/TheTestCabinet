// instrumentation/spawn-gem — `spawnGem('medium', 200, 0)` appears in the
// snapshot as a medium gem at (200, 0) with attracted false and the next id,
// and it stays put across 60 ticks with the lamplighter at the origin.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md, `spawnGem`: "Places
// one unattracted gem of `tier`, a `GemTier`, at `(x, y)` with the next id".
// specs/world.md, "Gems": "A gem sits where it was dropped until it is
// attracted", and one is attracted only "at most `pickupRadius`" (48) from the
// lamplighter or by a draft.
//
// THE POSE. An isolated run, the gem 200 units out, the read back without a
// frame, then sixty ticks.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import { captureStill, createHarness, isolate, type Harness } from "../harness";

const AT = { x: 200, y: 0 };
const HELD_TICKS = 60;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("places the gem as posed, and it stays put", async () => {
  isolate(h);
  const nextId = h.snapshot().run.nextId;

  h.debug.spawnGem("medium", AT.x, AT.y);
  const s = h.snapshot();
  assertEqual(s.run.nextId, nextId + 1, "nextId after the spawn");
  assertDeepEqual(
    s.run.gems,
    [{ id: nextId, tier: "medium", x: AT.x, y: AT.y, attracted: false }],
    "the gems after the spawn",
  );

  const held = await h.tick(HELD_TICKS);
  captureStill(h, "placed");
  assertDeepEqual(held.run.gems, s.run.gems, "the gems after 60 ticks");
});
