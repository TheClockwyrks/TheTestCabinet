// screens/paused-confirm-main-menu — `confirm` on `MAIN MENU` abandons the run
// for the title.
//
// WHERE THE THRESHOLD COMES FROM. specs/ui.md ("`paused`"): the menu
// `PAUSE_ITEMS`, "`RESUME`, `MAIN MENU`, in that order", of which "`MAIN MENU` |
// Abandons the run and returns to `title` with `menuIndex = 0`", and "`confirm`
// takes the highlighted item". specs/controls.md ("What each screen reads"),
// the `paused` row: "`confirm` takes the highlighted item". specs/state.md
// fixes what the title then holds: "Off the run, on `title`, `howto`, and
// `almanac`, the run's fields hold their idle values: tick `0`, level `1`, no
// experience, no kills, the lamplighter at the world origin facing right with
// `BASE_MAX_HP` (`100`) health and its hurt flash at `0`, no weapons, no
// passives, nothing alive, nothing dropped, no offers, no level-ups earned, no
// chest result, the spawn timer at `0`, no events fired, and the next id `0`",
// which `idleRun()` restates. specs/instrumentation.md says the same of the
// transition: `setScreen("title")` "Discards the run exactly as `TITLE` on an
// end screen or `MAIN MENU` on `paused` does: the idle run."
//
// WHY THE WORLD IS POSED AS IT IS. The paused run is given one of everything
// the idle run has none of — a clock, a level, experience, kills, a health
// short of full, a loadout, an enemy, a gem, a pickup and a queued level-up —
// so that "abandons" is told from "leaves the screen": a build that changed
// `screen` and kept the night standing fails. Every driver switch is off, so
// nothing but the presses clears anything. The surface carries no pose for
// `menuIndex`, so `MAIN MENU` is highlighted with `ArrowDown` from the `0` the
// screen is arrived on, read back before the confirm, and both presses are REAL
// keys through Chromium's input pipeline held across exactly one frame.
//
// THE TOLERANCE. None: a screen name, an index, and the idle run's figures are
// exact comparisons.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import { PAUSE_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  documentedRun,
  holdPassive,
  holdWeapon,
  idleRun,
  placeEnemy,
  placeGem,
  placePickup,
  pressConfirm,
  pressDown,
  pressPause,
  type Harness,
} from "../harness";
import { night } from "./stage";

/** The index of `MAIN MENU` in `PAUSE_ITEMS`. */
const MAIN_MENU = PAUSE_ITEMS.indexOf("MAIN MENU");

/** Figures the abandoned run holds, none of them the idle run's. */
const POSED = { tick: 4500, level: 7, xp: 12, kills: 250, hp: 77, pending: 2 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reads title with menuIndex 0 and the idle run when Enter takes MAIN MENU", async () => {
  await night(h);
  await holdWeapon(h, "ember", 3);
  await holdPassive(h, "brass", 2);
  await h.debug.setTick(POSED.tick);
  await h.debug.setLevel(POSED.level);
  await h.debug.setXp(POSED.xp);
  await h.debug.setKills(POSED.kills);
  await h.debug.setHp(POSED.hp);
  await h.debug.setPendingLevelUps(POSED.pending);
  await placeEnemy(h, "moth", 200, 0);
  await placeGem(h, "medium", -100, 0);
  await placePickup(h, "bread", 0, -100);
  const held = await pressPause(h);
  assertEqual(held.screen, "paused", "the screen the presses are made on");
  assertEqual(held.run.tick, POSED.tick, "the clock the paused run holds");
  let posed = held;
  for (let i = 0; i < MAIN_MENU; i += 1) posed = await pressDown(h);
  assertEqual(posed.menuIndex, MAIN_MENU, "the highlighted item, MAIN MENU");

  const title = await pressConfirm(h);
  await captureStill(h, "title");

  assertEqual(title.screen, "title", "the screen MAIN MENU left");
  assertEqual(title.menuIndex, 0, "menuIndex on arriving at the title");
  assertDeepEqual(
    documentedRun(title.run),
    idleRun(),
    "the run the title holds once the night is abandoned",
  );
});
