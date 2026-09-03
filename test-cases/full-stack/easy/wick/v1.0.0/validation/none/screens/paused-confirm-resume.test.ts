// screens/paused-confirm-resume — `confirm` on `RESUME` gives the run back
// exactly as the pause held it.
//
// WHERE THE THRESHOLD COMES FROM. specs/ui.md ("`paused`"): the menu
// `PAUSE_ITEMS`, "`RESUME`, `MAIN MENU`, in that order", of which "`RESUME` |
// Sets `screen = playing`, with the run untouched", and "`menuIndex` is `0` on
// arriving ... `confirm` takes the highlighted item". specs/controls.md ("What
// each screen reads"), the `paused` row: "`confirm` takes the highlighted
// item". specs/controls.md ("Actions and bindings"): "`confirm` | `Enter`,
// `Space`". specs/ui.md ("What advances on each screen"): while `paused`,
// "Nothing. The world beneath holds exactly the tick it was at", so the run the
// resume gives back is the run the pause took.
//
// WHY THE WORLD IS POSED AS IT IS. The night is isolated and then given a
// clock, a level, experience, kills, a health short of full, a lamplighter off
// the origin, a loadout, an enemy, a projectile, a puddle, a gem and a pickup,
// because "the run untouched" is only visible against a run that has something
// in it. `RESUME` is the item the screen arrives highlighted on, so nothing is
// pressed to reach it, and the index is read back before the confirm. The
// confirm is made across a frame of `SUB_TICK` seconds, because
// specs/controls.md has a frame's edges read against the screen it began on and
// then "The frame's update ... runs on the screen the edges left: a frame whose
// press enters `playing` ... runs that frame's ticks" — so a resume made across
// a whole tick would hand back a run one tick older, and the state the resume
// ARRIVES at is what this decides. The key is a dispatched `Enter` raised
// inside the same evaluation as the call, so no frame of the build's own
// real-time loop reads its edge first.
//
// THE TOLERANCE. None: the whole documented run is compared field for field
// against the reading taken while it was paused.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import { BINDINGS, PAUSE_ITEMS } from "../constants";
import {
  bracket,
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
import { night, SUB_TICK } from "./stage";

/** The key that takes the highlighted item: the first binding of `confirm`. */
const CONFIRM_KEY = BINDINGS.confirm[0]!;

/** The index of `RESUME` in `PAUSE_ITEMS`. */
const RESUME = PAUSE_ITEMS.indexOf("RESUME");

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

it("reads playing with the run exactly as the pause held it", async () => {
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
  const held = await pressPause(h);
  assertEqual(held.screen, "paused", "the screen the confirm is made on");
  assertEqual(held.menuIndex, RESUME, "the highlighted item, RESUME");

  const { after: resumed } = await bracket(h, "advance", [SUB_TICK], {
    hold: CONFIRM_KEY,
  });
  await captureStill(h, "resumed");

  assertEqual(resumed.screen, "playing", "the screen RESUME left");
  assertDeepEqual(
    documentedRun(resumed.run),
    documentedRun(held.run),
    "the run RESUME gives back",
  );
});
