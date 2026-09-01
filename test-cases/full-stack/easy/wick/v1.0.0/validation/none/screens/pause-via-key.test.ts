// screens/pause-via-key — `pause` on `playing` holds the run under the pause
// screen.
//
// WHERE THE THRESHOLD COMES FROM. specs/controls.md ("Actions and bindings"):
// "`pause` | `KeyP` | edge | pauses on `playing`; resumes on `paused`", and
// ("What each screen reads") the `playing` row: "`pause` opens `paused`".
// specs/ui.md ("`paused`"): "The world held still, with the HUD, under
// `PAUSED_TEXT` (`PAUSED`)". specs/ui.md ("Menu navigation"): "`menuIndex` is
// `0` on entering every screen". specs/ui.md ("What advances on each screen"):
// on `levelup`, `chest` and `paused` "Nothing. The world beneath holds exactly
// the tick it was at", and specs/controls.md: "a frame whose press leaves
// `playing` ticks nothing".
//
// WHY THE WORLD IS POSED AS IT IS. The night is isolated and then given
// something to hold: a clock, a level, experience, kills, a health short of
// full, a lamplighter off the origin, a loadout, an enemy, a projectile, a
// puddle, a gem and a pickup. "Held still" is only visible against a run that
// has something in it, and every driver switch is off, so nothing but the press
// could have moved any of it. The press is a REAL `KeyP` through Chromium's
// input pipeline held across exactly one frame.
//
// THE TOLERANCE. None: the whole documented run is compared field for field
// against the reading taken before the press, and a screen name and an index
// are exact.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  documentedRun,
  holdPassive,
  holdWeapon,
  placeEnemy,
  placeGem,
  placePickup,
  placeProjectile,
  placePuddle,
  pressPause,
  type Harness,
} from "../harness";
import { night } from "./stage";

/** Figures the night is posed with, none of them a fresh run's. */
const POSED = {
  tick: 4500,
  level: 7,
  xp: 12,
  kills: 250,
  hp: 77,
  x: 300,
  y: -120,
};

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reads paused with menuIndex 0 and the run exactly as KeyP found it", async () => {
  await night(h);
  await holdWeapon(h, "ember", 3);
  await holdPassive(h, "brass", 2);
  await h.debug.setTick(POSED.tick);
  await h.debug.setLevel(POSED.level);
  await h.debug.setXp(POSED.xp);
  await h.debug.setKills(POSED.kills);
  await h.debug.setHp(POSED.hp);
  await h.debug.setPlayerPosition(POSED.x, POSED.y);
  await placeEnemy(h, "moth", POSED.x + 200, POSED.y);
  await placeProjectile(h, "ember", POSED.x + 100, POSED.y, 400, 0, 0);
  await placePuddle(h, "oil-splash", POSED.x, POSED.y + 50);
  await placeGem(h, "medium", POSED.x - 100, POSED.y);
  await placePickup(h, "bread", POSED.x, POSED.y - 100);
  const playing = await h.snapshot();
  assertEqual(playing.screen, "playing", "the screen the press is made on");

  const paused = await pressPause(h);
  await captureStill(h, "paused");

  assertEqual(paused.screen, "paused", "the screen KeyP left");
  assertEqual(paused.menuIndex, 0, "menuIndex on arriving at paused");
  assertDeepEqual(
    documentedRun(paused.run),
    documentedRun(playing.run),
    "the run the pause holds",
  );
});
