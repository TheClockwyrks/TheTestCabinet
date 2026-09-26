// pointer/end-click-confirms — a click inside `TRY AGAIN`'s rectangle starts a
// fresh run.
//
// WHERE THE THRESHOLD COMES FROM. specs/controls.md ("The pointer"), rule 2: "A
// primary press edge inside the rectangle of the item at `menuIndex` `i` sets
// `menuIndex` to `i` ... and then takes that item exactly as `confirm` on it
// does." specs/ui.md ("`fallen` and `dawn`"): "`confirm` takes the highlighted
// item: `TRY AGAIN` starts a fresh run and sets `screen = playing`", the first
// of `END_ITEMS`. specs/ui.md ("A fresh run"): "`LIGHT THE LAMP` and `TRY AGAIN`
// each begin a fresh run, and whatever the previous run held is discarded", the idle run with "Taper at
// level `1` alone in the first weapon slot". specs/controls.md adds what the
// clicking frame itself does: "a frame whose press enters `playing` ... runs
// that frame's ticks", so the run is read one tick old.
//
// WHAT IS READ, AND WHY IT DECIDES THE CLAIM. The whole documented run, field
// for field, against the fresh run the specification states, less the clock the
// clicking frame ticked, which is asserted on its own. The ended run held a
// level, experience, kills, a loadout and entities, so a build that returned to
// play without discarding them fails on every one of those fields.
//
// HOW THE WORLD IS POSED. An isolated night given a level, experience, kills, a
// loadout, an enemy, a gem and a pickup, and then ended fallen the real way:
// specs/world.md ends a run fallen when "`hp` is `0` or below" at the end of a
// tick, which `setHp` at `0` reaches on the next `playing` tick. Every driver
// switch is off, so nothing the fresh run's first tick does could put an entity
// back.
//
// HOW THE GESTURE IS POSED. `menuRects()` reports where this build drew the two
// end-screen items, and the primary button is pressed at the middle of the
// FIRST, `TRY AGAIN`, with exactly one frame between press and release.
//
// THE TOLERANCE. None: the documented run is compared field for field against
// the fresh run, and a screen name and a tick count are exact.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import { END_ITEMS } from "../constants";
import {
  captureStill,
  clickAt,
  createHarness,
  documentedRun,
  FRESH_TAPER,
  holdPassive,
  holdWeapon,
  idleRun,
  placeEnemy,
  placeGem,
  placePickup,
  type Harness,
} from "../harness";
import { endFallen, menuPoints, night } from "./stage";

/** The item the click lands in: `TRY AGAIN`, the first of `END_ITEMS`. */
const CLICKED = END_ITEMS.indexOf("TRY AGAIN");

/** Figures the ended run holds, none of them a fresh run's. */
const POSED = { level: 7, xp: 12, kills: 250, pending: 2 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("begins a fresh run when a click lands in TRY AGAIN on fallen", async () => {
  await night(h);
  await holdWeapon(h, "ember", 3);
  await holdPassive(h, "brass", 2);
  await h.debug.setLevel(POSED.level);
  await h.debug.setXp(POSED.xp);
  await h.debug.setKills(POSED.kills);
  await h.debug.setPendingLevelUps(POSED.pending);
  await placeEnemy(h, "moth", 200, 0);
  await placeGem(h, "medium", -200, 0);
  await placePickup(h, "bread", 0, -200);
  const ended = await endFallen(h);
  assertEqual(ended.run.kills, POSED.kills, "the kills the ended run holds");
  const points = await menuPoints(
    h,
    END_ITEMS.length,
    "for the end screen's menu",
  );

  const fresh = await clickAt(h, points[CLICKED]!);
  await captureStill(h, "again");

  assertEqual(fresh.screen, "playing", "the screen the click left");
  assertDeepEqual(
    { ...documentedRun(fresh.run), tick: 0, time: 0 },
    idleRun([FRESH_TAPER]),
    "the run the click began, less the clock the clicking frame ticked",
  );
  assertEqual(
    fresh.run.tick,
    1,
    "the run clock after the frame that restarted",
  );
});
