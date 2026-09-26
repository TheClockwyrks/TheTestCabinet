// screens/fresh-run-discards-previous — a fresh run discards the previous one.
//
// WHAT THIS DECIDES. One thing: nothing the previous run held survives into the
// run `TRY AGAIN` starts. That a fresh run holds the right values is its own
// point; this one is that the old ones are gone rather than carried over.
//
// THE SPEC IT RESTS ON.
//   specs/ui.md ("A fresh run"): "`LIGHT THE LAMP` and `TRY AGAIN` each begin a
//   fresh run, and whatever the previous run held is discarded", with the fresh
//   run's fields restated as `FRESH_RUN`.
//   specs/ui.md ("`fallen` and `dawn`"): "`TRY AGAIN` starts a fresh run and
//   sets `screen = playing`", with `END_ITEMS` "`TRY AGAIN`, `TITLE`, in that
//   order" and "`menuIndex` is `0` on arriving".
//   specs/world.md ("Fallen and dawn"): "A tick that ends the run opens no
//   overlay: a chest it collected has its result applied and no overlay shown,
//   with `chestResult` left set so the end screen's run reports it, and a
//   level-up it queued stays queued", which is how the ended run this point
//   starts from carries a chest result and a queued level-up.
//   specs/instrumentation.md (`setHp`): "A value at or below `0` ends the run
//   fallen at the end of the next `playing` tick".
//
// THE DRIVE. An isolated `playing` run is loaded with everything a run can
// leave behind: two enemies, a gem, a pickup out of reach, two queued level-ups,
// and a chest at the lamplighter's center whose collection sets `chestResult`.
// Taper is held below its max level so the chest's result is a level rather
// than the heal that would carry `hp` back above `0`
// (specs/evolutions.md, "Opening a chest"). `hp` is posed to `0`, and one tick
// collects the chest, applies its result, and ends the run, so the fallen
// screen is reached the way play reaches it, with every one of those things
// still on the field. Then one `Enter` on `TRY AGAIN`,
// delivered on a frame of half a tick so the run read back is the one the
// transition built rather than one the director has already spawned into
// (specs/controls.md, "a frame whose press enters `playing` ... runs that
// frame's ticks").
//
// THE TOLERANCE. None: every field of the fresh run is exact, and the
// preconditions are counts.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertGreaterThan,
  assertNotNull,
} from "../assert";
import { FRESH_RUN, END_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  holdWeapon,
  isolate,
  runFields,
  spawnEnemyAt,
  spawnGemAt,
  spawnPickupAt,
  tapWithoutTick,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("carries nothing of the ended run into the run TRY AGAIN starts", async () => {
  isolate(h);
  holdWeapon(h, "taper", 3);
  spawnEnemyAt(h, "moth", 300, 0);
  spawnEnemyAt(h, "gnat", -300, 120);
  spawnGemAt(h, "large", 0, 400);
  spawnPickupAt(h, "bread", 0, -400);
  h.debug.setKills(37);
  h.debug.setPendingLevelUps(2);
  h.debug.setHp(0);
  spawnPickupAt(h, "chest", 0, 0);

  const ended = await h.tick(1);
  assertEqual(
    ended.screen,
    "fallen",
    "the screen the ending tick left the run on",
  );
  assertEqual(
    ended.menuIndex,
    END_ITEMS.indexOf("TRY AGAIN"),
    "the highlight on TRY AGAIN",
  );
  assertGreaterThan(
    ended.run.enemies.length,
    0,
    "enemies on the field of the ended run",
  );
  assertGreaterThan(
    ended.run.gems.length,
    0,
    "gems on the field of the ended run",
  );
  assertGreaterThan(
    ended.run.pickups.length,
    0,
    "pickups on the field of the ended run",
  );
  assertGreaterThan(
    ended.run.pendingLevelUps,
    0,
    "level-ups queued by the ended run",
  );
  assertNotNull(ended.run.chestResult, "the chest result the ended run kept");

  const after = await tapWithoutTick(h, "Enter");
  captureStill(h, "discarded");

  assertEqual(after.screen, "playing", "the screen TRY AGAIN left the game on");
  assertDeepEqual(
    runFields(after.run),
    FRESH_RUN,
    "the run TRY AGAIN started, holding nothing of the run before it",
  );
});
