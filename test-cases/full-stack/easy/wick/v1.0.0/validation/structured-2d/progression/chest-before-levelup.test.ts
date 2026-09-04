// Wick — progression/chest-before-levelup: a chest collected on a level-up
// tick opens first, and the level-up overlay waits for the next playing tick.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/progression.md`, "The
// level-up overlay": "A tick that collects a chest opens the chest overlay
// instead, and the level-ups queued on that tick open their overlay at the end
// of the next `playing` tick." "The chest overlay": "`confirm` closes it,
// setting `chestResult` to `null` and `screen` to `playing`."
// `specs/world.md`, phase 12: "a tick that collected a chest opens the chest
// overlay, and a tick that ends with a level-up queued and no chest collected
// opens the level-up overlay".
//
// THE POSE. An isolated `playing` run holding nothing, at level `1` with `xp`
// `4`; one chest pickup and one small gem, both on the lamplighter's own
// center, so a single tick collects both: the pickup phase takes the chest and
// the gem phase takes the level. `specs/instrumentation.md` makes
// `setScreen("playing")` from `chest` exactly what `confirm` does there, so
// the overlay is closed the way the game closes it and one further tick is
// run. Holding nothing, the chest's result is the heal of
// `specs/evolutions.md`, which no assertion here reads.
//
// THE TOLERANCE. Exact: two screen names and a whole queue length.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  advanceTicks,
  captureReplay,
  createHarness,
  isolate,
  placeGem,
  placePickup,
  type Harness,
} from "../harness";

const LEVEL = 1;
const XP_BEFORE = 4;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("ends the collecting tick on chest and opens the level-up overlay a tick later", async () => {
  const { player } = isolate(h).run;
  h.debug.setLevel(LEVEL);
  h.debug.setXp(XP_BEFORE);
  placePickup(h, "chest", player.x, player.y);
  placeGem(h, "small", player.x, player.y);

  const [chest, after] = await captureReplay(h, "chest", async () => {
    const collected = await advanceTicks(h, 1);
    // `specs/instrumentation.md`: `setScreen("playing")` from `chest` closes
    // the overlay exactly as `confirm` does.
    h.debug.setScreen("playing");
    return [collected, await advanceTicks(h, 1)] as const;
  });
  assertEqual(
    chest.screen,
    "chest",
    "screen at the end of the tick that collected the chest and queued a level-up",
  );
  assertEqual(
    chest.run.pendingLevelUps,
    1,
    "run.pendingLevelUps held over the chest overlay",
  );
  assertEqual(
    chest.run.level,
    LEVEL + 1,
    "run.level after the gem crossing the threshold",
  );
  assertEqual(
    after.screen,
    "levelup",
    "screen at the end of the playing tick after the chest overlay closed",
  );
  assertEqual(
    after.run.pendingLevelUps,
    1,
    "run.pendingLevelUps on the opened level-up overlay",
  );
});
