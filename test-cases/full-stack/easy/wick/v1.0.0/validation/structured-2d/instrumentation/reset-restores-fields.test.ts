// Wick — instrumentation/reset-restores-fields: from a thoroughly disturbed
// run, `reset()` returns the game to `title` with `menuIndex` 0, the idle run,
// and the accumulator and `simTime` at 0.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/instrumentation.md`,
// `reset(options)`: "Restores every declared field of the game's state to its
// title-screen value: the `title` screen with `menuIndex` `0`, the idle run of
// `specs/state.md`, the accumulator and `simTime` at `0`". `specs/state.md`,
// "The idle run", is the table `IDLE_RUN` transcribes, derived fields included.
//
// THE DISTURBANCE. Every field the idle run names is moved off its value
// first, so a `reset` that restored only some of them is caught: the
// lamplighter moved, turned, and hurt; level, xp, kills, tick, spawn timer,
// pending level-ups, and a queued offer list posed; weapons and passives
// held; an enemy, a bolt, a puddle, a gem, and a bread on the field; the
// swarm event fired by carrying the clock over tick 3600 with `events` on;
// then real ticks and a partial frame, so the accumulator and `simTime` are
// off zero too. The switches and `muted` are other items' (`reset-restores-
// switches`, `reset-keeps-muted`); `rngState` is `reset-seeds-rng`'s.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  IDLE_RUN,
  advanceTicks,
  captureStill,
  createHarness,
  enable,
  holdPassive,
  holdWeapon,
  isolate,
  placeEnemy,
  placeGem,
  placePickup,
  placeProjectile,
  placePuddle,
  type Harness,
} from "../harness";

/** The tick before the 60 s swarm event, so one tick with `events` on fires it. */
const TICK_BEFORE_SWARM = 3599;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("returns every declared field to its title-screen value", async () => {
  isolate(h, { seed: 3 });
  h.debug.setTick(TICK_BEFORE_SWARM);
  enable(h, "events");
  await advanceTicks(h, 1);
  h.debug.setEvents(false);
  h.debug.clearEnemies();
  h.debug.setPlayerPosition(300, -120);
  h.debug.setFacing("left");
  h.debug.setHp(12);
  h.debug.setLevel(7);
  h.debug.setXp(4.5);
  h.debug.setKills(40);
  h.debug.setSpawnTimer(0.7);
  h.debug.setNextOffers(["pin", "lure"]);
  holdWeapon(h, "ember", 4);
  holdPassive(h, "brass", 2);
  placeEnemy(h, "moth", 200, 0);
  placeProjectile(h, "pin", 100, 0, 600, 0, 1);
  placePuddle(h, "oil-splash", 50, 50);
  placeGem(h, "large", 300, 100);
  placePickup(h, "bread", -300, 0);
  await advanceTicks(h, 3);
  await h.frameOf(25);
  const disturbed = h.snapshot();
  assertEqual(
    disturbed.run.firedEvents.length,
    1,
    "the event fired before reset",
  );

  h.reset();
  const after = h.snapshot();
  await h.frameDraw();
  captureStill(h, "reset");

  assertEqual(after.screen, "title", "screen after reset");
  assertEqual(after.menuIndex, 0, "menuIndex after reset");
  assertDeepEqual(after.run, IDLE_RUN, "run after reset");
  assertEqual(after.accumulator, 0, "accumulator after reset");
  assertEqual(after.simTime, 0, "simTime after reset");
});
