// Wick — screens/fresh-run-discards-previous: nothing the previous run held
// survives into the one `TRY AGAIN` starts.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/ui.md`, "A fresh run":
// "`LIGHT THE LAMP`, `TRY AGAIN`, and the debug surface's
// `setScreen("playing")` each begin a fresh run, and whatever the previous run
// held is discarded", with "no enemy, projectile, zone, gem, or pickup in the
// world, no level-up queued", level `1`, `kills = 0`, and `specs/state.md`'s
// idle values for `offers` and `chestResult`. `specs/ui.md`,
// "`fallen` and `dawn`": `END_ITEMS` is `TRY AGAIN`, `TITLE` "in that order",
// `menuIndex` is `0` on arriving, and "`TRY AGAIN` starts a fresh run and sets
// `screen = playing`".
//
// HOW THE PREVIOUS RUN IS LEFT FULL. An isolated `playing` run keeping its
// Taper, posed with a moth, a gem, and a loaf 400 units away — outside
// `PICKUP_RADIUS` (`48`) and `COLLECT_RADIUS` (`8`), so the ending tick
// collects none of them — two level-ups queued, `hp` at `0`, and a chest at
// the lamplighter's own center. That one tick collects the chest, levels the
// held Taper for its result, and ends the run: `specs/world.md`, "Fallen and
// dawn", says "A tick that ends the run opens no overlay: a chest it collected
// has its result applied and no overlay shown, with `chestResult` left set so
// the end screen's run reports it, and a level-up it queued stays queued". So
// the fallen screen is reached holding every one of the things a fresh run
// must discard, which is read back before the press.
//
// THE DRIVE. One real `Enter` on `TRY AGAIN`, the item the arrival highlights.
// Its frame runs one tick of the NEW run, with every driver switch left off by
// the isolation, so nothing autonomous puts anything back.
//
// THE TOLERANCE. None: list lengths, whole counts, and `null`.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThanOrEqual,
  assertLength,
  assertNotNull,
  assertNull,
} from "../assert";
import {
  advanceTicks,
  captureStill,
  createHarness,
  isolate,
  placeEnemy,
  placeGem,
  placePickup,
  tap,
  type Harness,
} from "../harness";

/** Far enough from the lamplighter that the ending tick collects none of it. */
const AWAY = 400;
/** Level-ups queued on the run that ends, which the ending tick keeps queued. */
const QUEUED = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("starts the new run holding none of the ended run's world", async () => {
  isolate(h, { keepTaper: true });
  h.debug.setLevel(6);
  h.debug.setKills(143);
  placeEnemy(h, "moth", AWAY, 0);
  placeGem(h, "small", AWAY, 0);
  placePickup(h, "bread", AWAY, 0);
  h.debug.setPendingLevelUps(QUEUED);
  h.debug.setHp(0);
  const { player } = h.snapshot().run;
  placePickup(h, "chest", player.x, player.y);

  const ended = await advanceTicks(h, 1);
  assertEqual(ended.screen, "fallen", "the screen the ending tick left");
  assertEqual(ended.menuIndex, 0, "the highlighted item, TRY AGAIN");
  assertLength(ended.run.enemies, 1, "the enemies the ended run held");
  assertLength(ended.run.gems, 1, "the gems the ended run held");
  assertLength(ended.run.pickups, 1, "the pickups the ended run held");
  assertGreaterThanOrEqual(
    ended.run.pendingLevelUps,
    1,
    "the level-ups the ended run kept queued",
  );
  assertNotNull(ended.run.chestResult, "the chest result the ended run kept");

  const again = await tap(h, "Enter");
  captureStill(h, "discarded");

  assertEqual(again.screen, "playing", "the screen after confirming TRY AGAIN");
  assertLength(again.run.enemies, 0, "the enemies the fresh run holds");
  assertLength(again.run.projectiles, 0, "the projectiles the fresh run holds");
  assertLength(again.run.zones, 0, "the zones the fresh run holds");
  assertLength(again.run.gems, 0, "the gems the fresh run holds");
  assertLength(again.run.pickups, 0, "the pickups the fresh run holds");
  assertLength(again.run.offers, 0, "the offers the fresh run holds");
  assertEqual(
    again.run.pendingLevelUps,
    0,
    "the level-ups the fresh run queues",
  );
  assertNull(again.run.chestResult, "chestResult on the fresh run");
  assertEqual(again.run.level, 1, "the level the fresh run starts at");
  assertEqual(again.run.kills, 0, "the kills the fresh run starts with");
});
