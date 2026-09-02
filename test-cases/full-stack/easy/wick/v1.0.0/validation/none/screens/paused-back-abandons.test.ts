// screens/paused-back-abandons — `back` on `paused` abandons the run for the
// title.
//
// WHERE THE THRESHOLD COMES FROM. specs/ui.md ("`paused`"): "`back` abandons
// the run and returns to `title` with `menuIndex = 0`." specs/controls.md
// ("What each screen reads"), the `paused` row: "`back` abandons the run and
// returns to `title`". specs/state.md fixes what the title then holds: "Off the
// run, on `title` and `howto`, the run's fields hold their idle values: tick
// `0`, level `1`, no experience, no kills, the lamplighter at the world origin
// facing right with `BASE_MAX_HP` (`100`) health, no weapons, no passives,
// nothing alive, nothing dropped, no offers, no level-ups earned, no chest
// result, the spawn timer at `0`, no events fired, and the next id `0`", which
// `idleRun()` restates. specs/instrumentation.md says the same of the
// transition: `setScreen("title")` "Discards the run exactly as `TITLE` on an
// end screen or `back` on `paused` does: the idle run."
//
// WHY THE WORLD IS POSED AS IT IS. The paused run is given one of everything
// the idle run has none of — a clock, a level, experience, kills, a loadout, an
// enemy, a gem, a pickup and a queued level-up — so that "abandons" is told
// from "leaves the screen": a build that changed `screen` and kept the night
// standing fails. Every driver switch is off, so nothing but the press clears
// anything, and the press is a REAL `Escape` held across exactly one frame.
//
// THE TOLERANCE. None: the whole documented run is compared against the idle
// run field for field.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
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
  pressBack,
  pressPause,
  type Harness,
} from "../harness";
import { night } from "./stage";

/** Figures the abandoned run holds, none of them the idle run's. */
const POSED = { tick: 4500, level: 7, xp: 12, kills: 250, hp: 77, pending: 2 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reads title with menuIndex 0 and the idle run after Escape on paused", async () => {
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
  assertEqual(held.screen, "paused", "the screen the press is made on");
  assertEqual(held.run.tick, POSED.tick, "the clock the paused run holds");

  const title = await pressBack(h);
  await captureStill(h, "abandoned");

  assertEqual(title.screen, "title", "the screen Escape left");
  assertEqual(title.menuIndex, 0, "menuIndex on arriving at the title");
  assertDeepEqual(
    documentedRun(title.run),
    idleRun(),
    "the run the title holds once the night is abandoned",
  );
});
