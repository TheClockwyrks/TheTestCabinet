// screens/playing-back-inert — `back` does nothing on the playing screen.
//
// WHERE THE THRESHOLD COMES FROM. specs/controls.md ("What each screen reads"),
// the `playing` row: "`pause` opens `paused`; `mute`", naming no `back`, and
// beneath the table "An action a row omits does nothing on that screen."
// specs/controls.md ("Actions and bindings"): "`back` | `Escape` | edge |
// leaves the screen, as the screen table below states."
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night with nothing alive,
// carrying a loadout, a level, health short of full and kills, none of them a
// fresh run's: "does nothing" has to be told from "abandons the night", and a
// build that sent `back` through the path `paused` gives it would answer the
// title on the idle run while one that ended the run would answer an end
// screen. The press is a REAL `Escape` held across exactly one frame.
//
// WHAT A TICKING FRAME LEAVES. specs/controls.md has a frame's edges read
// against the screen the frame began on and "The frame's update then runs on
// the screen the edges left", so the frame carrying the press ticks the night:
// the clock, the timers and the world advance across it, and none of them is
// read here. What is read is the screen and the run the tick leaves alone —
// the slots, the level, health and kills, over a night holding no enemy to
// hurt the lamplighter and no gem to raise the level.
//
// THE TOLERANCE. None: a screen name, a level, health, a kill count and the
// slots' ids and levels are exact comparisons.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  holdPassive,
  holdWeapon,
  pressBack,
  type Harness,
  type RunView,
} from "../harness";
import { night } from "./stage";

/** Figures the night carries, none of them a fresh run's. */
const POSED = { level: 7, hp: 77, kills: 250 };

/** The slots as this point reads them: what each holds, and at what level. */
function loadout(run: RunView): string[] {
  return [
    ...(run.weapons ?? []).map((held) => `weapon ${held.id} ${held.level}`),
    ...(run.passives ?? []).map((held) => `passive ${held.id} ${held.level}`),
  ];
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves playing and the night's loadout, level, health and kills after Escape", async () => {
  await night(h);
  await holdWeapon(h, "ember", 3);
  await holdPassive(h, "brass", 2);
  await h.debug.setLevel(POSED.level);
  await h.debug.setHp(POSED.hp);
  await h.debug.setKills(POSED.kills);
  const before = await h.snapshot();
  assertEqual(before.screen, "playing", "the screen the press is made on");
  assertEqual(before.run.player.hp, POSED.hp, "the health the press finds");

  const after = await pressBack(h);
  await captureStill(h, "inert");

  assertEqual(after.screen, "playing", "the screen after Escape on playing");
  assertDeepEqual(
    loadout(after.run),
    loadout(before.run),
    "the slots after Escape",
  );
  assertEqual(after.run.level, POSED.level, "the level after Escape");
  assertEqual(after.run.player.hp, POSED.hp, "the health after Escape");
  assertEqual(after.run.kills, POSED.kills, "the kills after Escape");
});
