// Wick — instrumentation/reset-restores-fields: from a thoroughly disturbed run,
// `reset()` returns the game to `title` with `menuIndex` `0`, `almanacTab` `0`,
// `almanacScroll` `0` and the idle run, with `accumulator` and `simTime` at `0`.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md — `reset(options)`):
// "Restores every declared field of the game's state to its title-screen value:
// the `title` screen with `menuIndex`, `almanacTab`, and `almanacScroll` all
// `0`, the idle run of `specs/state.md`, the accumulator and `simTime` at `0`".
// The idle run is specs/state.md's list — "tick `0`, level `1`, no experience,
// no kills, the lamplighter at the world origin facing right with `BASE_MAX_HP`
// (`100`) health and `hurtFlash` `0`, no weapons, no passives, nothing alive,
// nothing dropped, no offers, no level-ups earned, no chest result, the spawn
// timer at `0`, no events fired, and the next id `0`" — which `idleRun()`
// restates, with the derived fields each formula gives an empty loadout. The
// comparison is exact: a reset restores, it does not approximate.
//
// WHY THE WORLD IS POSED AS IT IS. Every field the idle run names is first
// driven AWAY from its idle value — the clock, the level, the experience, the
// kills, the lamplighter's position, facing, and health, the hurt flash a
// contact hit arms, both loadouts, every entity kind, the queued level-ups, the
// queued offers, the spawn timer, a fired event, and the accumulator — so a
// reset that restored nothing, or restored only some fields, cannot pass by
// accident. The two almanac indices are driven away in a pose of their own,
// because "The almanac holds the idle run" (specs/ui.md): no one state carries
// both a run that has been played and a list that has been scrolled, so each is
// disturbed and reset in turn. The call is bracketed inside the page, because
// the same document leaves the build's own loop running in real time while the
// clock is held and has `simTime` rise by the delta of every frame it runs, so a
// reading of the `0` a reset leaves taken across two crossings would count the
// frames that ran after it.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertNotEqual } from "../assert";
import { ALMANAC_ROWS, EVENTS } from "../constants";
import {
  advanceBy,
  bracket,
  captureStill,
  createHarness,
  disable,
  documentedRun,
  enable,
  holdPassive,
  holdWeapon,
  idleRun,
  isolate,
  placeEnemy,
  placeEnemyNear,
  placeGem,
  placePickup,
  placeProjectile,
  placePuddle,
  poseScreen,
  pressAction,
  pressDown,
  type Harness,
} from "../harness";

/** The tick before the first scripted event, so one tick with events on fires it. */
const BEFORE_FIRST_EVENT = EVENTS[0]!.tick - 1;

/** The tab the almanac is driven to: `ENEMIES`, the third of `ALMANAC_TABS`. */
const DISTURBED_TAB = 2;

/** Entry moves down that tab, one past the last visible row, so the list scrolls. */
const DISTURBED_MOVES = ALMANAC_ROWS;

/** How far from the lamplighter's center the rat is posed: 20, inside 12 + 12. */
const RAT_OFFSET = 20;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("restores every declared field to its title-screen value", async () => {
  await isolate(h);
  await h.debug.setTick(BEFORE_FIRST_EVENT);
  await h.debug.setEvents(true);
  await h.step(1); // fires the swarm: gnats alive, `firedEvents` non-empty
  await h.debug.setEvents(false);
  // A contact hit, so the hurt flash is running when the reset lands: a rat's
  // radius is 12 and `PLAYER_RADIUS` is 12, so one posed 20 units out overlaps.
  await enable(h, "enemyContact");
  await placeEnemyNear(h, "rat", RAT_OFFSET, 0);
  await h.step(1);
  await disable(h, "enemyContact");
  // A partial frame, so the accumulator holds a remainder; posed before the
  // level-up is queued, since a tick that opens an overlay discards it.
  const partial = await advanceBy(h, 0.02);
  assertNotEqual(partial.accumulator, 0, "the accumulator before the reset");
  await h.debug.setLevel(5);
  await h.debug.setXp(3);
  await h.debug.setKills(9);
  await h.debug.setPlayerPosition(300, -120);
  await h.debug.setFacing("left");
  await h.debug.setHp(40);
  await holdWeapon(h, "ember", 2);
  await holdPassive(h, "brass", 1);
  await placeEnemy(h, "moth", 200, 0);
  await placeProjectile(h, "ember", 100, 0, 400, 0, 0);
  await placePuddle(h, "oil-splash", 50, 50);
  await placeGem(h, "medium", -200, 0);
  await placePickup(h, "bread", 0, -200);
  await h.debug.setPendingLevelUps(2);
  await h.debug.setNextOffers(["pin"]);
  await h.debug.setSpawnTimer(0.7);
  const disturbed = await h.snapshot();
  assertNotEqual(
    disturbed.run.firedEvents.length,
    0,
    "events fired before the reset",
  );
  assertNotEqual(
    disturbed.run.pendingLevelUps,
    0,
    "level-ups queued before the reset",
  );
  assertNotEqual(
    disturbed.run.hurtFlash,
    0,
    "the flash running before the reset",
  );

  const { after: title } = await bracket(h, "reset");
  await captureStill(h, "reset");

  assertEqual(title.screen, "title", "the screen a reset leaves");
  assertEqual(title.menuIndex, 0, "menuIndex after a reset");
  assertDeepEqual(
    documentedRun(title.run),
    idleRun(),
    "the run a reset leaves",
  );
  assertEqual(title.accumulator, 0, "the accumulator a reset leaves");
  assertEqual(title.simTime, 0, "simTime a reset leaves");

  // The two almanac indices, driven away in a pose of their own.
  await poseScreen(h, "almanac");
  for (let move = 0; move < DISTURBED_TAB; move += 1) {
    await pressAction(h, "right");
  }
  for (let move = 0; move < DISTURBED_MOVES; move += 1) await pressDown(h);
  const browsing = await h.snapshot();
  assertEqual(browsing.almanacTab, DISTURBED_TAB, "the tab before the reset");
  assertNotEqual(browsing.almanacScroll, 0, "the scroll before the reset");

  await h.debug.reset();
  const browsed = await h.snapshot();

  assertEqual(
    browsed.screen,
    "title",
    "the screen a reset leaves the almanac on",
  );
  assertEqual(browsed.almanacTab, 0, "almanacTab after a reset");
  assertEqual(browsed.almanacScroll, 0, "almanacScroll after a reset");
});
