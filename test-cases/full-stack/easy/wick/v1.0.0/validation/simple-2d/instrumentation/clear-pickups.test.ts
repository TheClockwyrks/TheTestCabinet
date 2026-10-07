// instrumentation/clear-pickups — `clearPickups()` with a chest, bread, and a
// draft on the field leaves pickups empty, hp unchanged, no gem attracted,
// and no overlay opened.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md, `clearPickups`:
// "Removes every pickup; nothing is collected". specs/world.md, "Pickups": a
// collected chest opens the chest overlay, bread heals BREAD_HEAL, a draft
// attracts every gem, so each of the three would show if the clear collected.
//
// THE POSE. An isolated run with hp posed below its max and a gem far out, the
// three pickups at the lamplighter's own center where the next tick WOULD
// collect them, the clear, the read back without a frame, and one tick more
// to show nothing was queued for it.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  isolate,
  spawnGemAt,
  spawnPickupAt,
  type Harness,
} from "../harness";

const HELD_HP = 40;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("removes every pickup and collects none", async () => {
  isolate(h);
  h.debug.setHp(HELD_HP);
  const { x, y } = h.snapshot().run.player;
  const gem = spawnGemAt(h, "small", x + 400, y);
  spawnPickupAt(h, "chest", x, y);
  spawnPickupAt(h, "bread", x, y);
  spawnPickupAt(h, "draft", x, y);
  assertLength(h.snapshot().run.pickups, 3, "the pickups before the clear");

  h.debug.clearPickups();
  const s = h.snapshot();
  assertLength(s.run.pickups, 0, "the pickups after the clear");
  assertEqual(s.run.player.hp, HELD_HP, "hp across the clear");

  const after = await h.tick(1);
  captureStill(h, "cleared");
  assertEqual(after.screen, "playing", "the screen after the next tick");
  assertEqual(after.run.player.hp, HELD_HP, "hp after the next tick");
  assertEqual(after.run.chestResult, null, "chestResult after the next tick");
  assertEqual(
    after.run.gems.find((entry) => entry.id === gem)?.attracted,
    false,
    "the far gem, unattracted",
  );
});
