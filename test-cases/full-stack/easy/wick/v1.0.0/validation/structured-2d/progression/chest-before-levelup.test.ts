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
// the gem phase takes the level, with `progression` the one driver switch
// turned on so the gain is spent. The chest overlay is then left with
// `setScreen("playing")`, which sets the screen alone
// (`specs/instrumentation.md`), and one further tick is run: phase 12 keys the
// level-up overlay off whether THAT tick collected a chest, so the
// `chestResult` the pose leaves standing changes nothing it decides, and no
// menu press is driven on the way. Holding nothing, the chest's result is the heal of
// `specs/evolutions.md`, which no assertion here reads.
//
// THE TOLERANCE. Exact: two screen names and a whole queue length.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  advanceTicks,
  captureReplay,
  createHarness,
  enable,
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
  // `progression`, the faculty that spends a gain on levels, is the one
  // switch this point is about, so it is turned back on and the other eight
  // stay held (`specs/instrumentation.md`, the switch table).
  const { player } = isolate(h).run;
  enable(h, "progression");
  h.debug.setLevel(LEVEL);
  h.debug.setXp(XP_BEFORE);
  placePickup(h, "chest", player.x, player.y);
  placeGem(h, "small", player.x, player.y);

  const [chest, after] = await captureReplay(h, "chest", async () => {
    const collected = await advanceTicks(h, 1);
    // `setScreen` sets the screen alone (`specs/instrumentation.md`), which
    // is all this point needs: the next tick collects no chest, so phase 12
    // reaches the queued level-up.
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
