// instrumentation/spawn-pickup — `spawnPickup('bread', 200, 0)` appears in
// the snapshot as a bread pickup at (200, 0) with the next id, and it stays
// put across 60 ticks.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md, `spawnPickup`:
// "Places one pickup of `kind`, a `PickupKind`, at `(x, y)` with the next
// id". specs/world.md, "Pickups": a pickup "sits where it was dropped and
// stays on the field until it is collected", and is collected only within
// PICKUP_ITEM_RADIUS + PLAYER_RADIUS (28) of the lamplighter.
//
// THE POSE. An isolated run, the pickup 200 units out, the read back without
// a frame, then sixty ticks.

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

it("places the pickup as posed, and it stays put", async () => {
  isolate(h);
  const nextId = h.snapshot().run.nextId;

  h.debug.spawnPickup("bread", AT.x, AT.y);
  const s = h.snapshot();
  assertEqual(s.run.nextId, nextId + 1, "nextId after the spawn");
  assertDeepEqual(
    s.run.pickups,
    [{ id: nextId, kind: "bread", x: AT.x, y: AT.y }],
    "the pickups after the spawn",
  );

  const held = await h.tick(HELD_TICKS);
  captureStill(h, "placed");
  assertDeepEqual(
    held.run.pickups,
    s.run.pickups,
    "the pickups after 60 ticks",
  );
});
