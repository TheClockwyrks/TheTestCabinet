// screens/playing-back-pauses — `back` on `playing` opens the pause screen and
// holds the run.
//
// WHERE THE THRESHOLD COMES FROM. specs/controls.md ("What each screen reads"),
// the `playing` row: "`pause` opens `paused`; `back` opens `paused`; `mute`",
// and beneath the table "`back` on `playing` does exactly what `pause` on
// `playing` does". specs/controls.md ("Actions and bindings"): "`back` |
// `Escape` | edge | leaves the screen, as the screen table states".
// specs/ui.md ("`paused`"): "The world held still, with the HUD, under
// `PAUSED_TEXT` (`PAUSED`)", and "`menuIndex` is `0` on arriving".
// specs/ui.md ("What advances on each screen"): on `levelup`, `chest` and
// `paused` "Nothing. The world beneath holds exactly the tick it was at", and
// specs/controls.md: "a frame whose press leaves `playing` ticks nothing and
// discards the accumulator".
//
// WHY THE WORLD IS POSED AS IT IS. The night is isolated and then given
// something to hold: a clock, a level, experience, kills, a health short of
// full, a lamplighter off the origin, a loadout, an enemy, a projectile, a
// puddle, a gem and a pickup. "Opens `paused`" has to be told from "abandons
// the night" and from "ends the run", which a bare screen name cannot do, so
// the whole run is read either side of the press; every driver switch is off,
// so nothing but the press could have moved any of it. The press is a REAL
// `Escape` through Chromium's input pipeline held across exactly one frame,
// posed exactly as `pause-via-key` poses `KeyP`, because the two are stated to
// do the same thing.
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
  pressBack,
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

it("reads paused with menuIndex 0 and the run exactly as Escape found it", async () => {
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

  const paused = await pressBack(h);
  await captureStill(h, "paused");

  assertEqual(paused.screen, "paused", "the screen Escape on playing left");
  assertEqual(paused.menuIndex, 0, "menuIndex on arriving at paused");
  assertDeepEqual(
    documentedRun(paused.run),
    documentedRun(playing.run),
    "the run the pause holds",
  );
});
