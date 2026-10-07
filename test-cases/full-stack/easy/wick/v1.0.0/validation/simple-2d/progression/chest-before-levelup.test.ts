// progression/chest-before-levelup — a tick that both collects a chest and
// queues a level-up ends on the chest overlay, and the level-up overlay waits
// for the next playing tick.
//
// THE ORDER, FROM THE SPEC. specs/progression.md, The level-up overlay: "A tick
// that collects a chest opens the chest overlay instead, and the level-ups
// queued on that tick open their overlay at the end of the next playing tick."
// Phase 12 of specs/world.md, One tick: "a tick that collected a chest opens
// the chest overlay, and a tick that ends with a level-up queued and no chest
// collected opens the level-up overlay". The chest overlay is left through
// setScreen("playing"), which from chest "Closes the overlay exactly as confirm
// does: chestResult becomes null" (specs/instrumentation.md).
//
// THE POSE. An isolated night with nothing on the field, nothing held, and
// every driver switch off. Level 1 and xp 4 are posed, one small gem
// (GEM_VALUES.small, 1) short of the XP_BASE (5) threshold, and both a chest
// and a small gem are placed at the lamplighter's center: the chest is
// collected in phase 8 and the gem in phase 9 of the same tick, so that one
// tick ends with a chest collected and a level-up queued. With nothing held no
// weapon can evolve and no item is below its max, so the chest's result is the
// heal of the third rule of specs/evolutions.md, which touches neither the
// queue nor the screen.
//
// THE TOLERANCE. None: the screen is discrete and pendingLevelUps is a whole
// count. A build that lets the level-up overlay win reads levelup on the
// collecting tick.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { XP_BASE } from "../constants";
import {
  captureReplay,
  createHarness,
  enable,
  isolate,
  spawnGemAt,
  spawnPickupAt,
  type Harness,
} from "../harness";

/** The level the gain is read at, whose threshold is XP_BASE. */
const POSED_LEVEL = 1;

/** The experience posed: one small gem short of the threshold. */
const POSED_XP = XP_BASE - 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("ends the collecting tick on chest with the level-up still queued, and opens it on the next playing tick", async () => {
  isolate(h);
  // The order the two overlays take is the requirement: `drops` stays off (the
  // gem and the chest are posed), and `progression` is on because the queued
  // level-up the chest stands in front of is what the point reads.
  enable(h, "progression");
  h.debug.setLevel(POSED_LEVEL);
  h.debug.setXp(POSED_XP);
  const { player } = h.snapshot().run;
  spawnPickupAt(h, "chest", player.x, player.y);
  spawnGemAt(h, "small", player.x, player.y);

  const collected = await captureReplay(h, "chest", async () => {
    const onChest = await h.tick(1);
    // The screen posed back to `playing`, then one playing tick, which is the
    // tick the queued level-up's overlay opens at the end of. `setScreen` sets
    // the screen alone, so nothing but the screen moves here.
    h.debug.setScreen("playing");
    const afterClose = await h.tick(1);
    return { onChest, afterClose };
  });

  assertEqual(
    collected.onChest.run.level,
    POSED_LEVEL + 1,
    "the gain the collecting tick made",
  );
  assertEqual(
    collected.onChest.screen,
    "chest",
    "the screen the collecting tick ended on",
  );
  assertEqual(
    collected.onChest.run.pendingLevelUps,
    1,
    "the level-up still queued behind the chest",
  );
  assertEqual(
    collected.afterClose.screen,
    "levelup",
    "the screen the next playing tick ended on",
  );
});
