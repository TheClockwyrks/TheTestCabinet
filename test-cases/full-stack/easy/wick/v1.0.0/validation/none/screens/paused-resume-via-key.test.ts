// screens/paused-resume-via-key — `pause` on `paused` gives the run back
// exactly as it was held.
//
// WHERE THE THRESHOLD COMES FROM. specs/controls.md ("Actions and bindings"):
// "`pause` | `KeyP` | edge | pauses on `playing`; resumes on `paused`", and
// ("What each screen reads") the `paused` row: "`pause` resumes `playing`".
// specs/ui.md ("`paused`"): "`pause` returns to `playing`". specs/ui.md ("What
// advances on each screen"): while `paused`, "Nothing. The world beneath holds
// exactly the tick it was at", so the run the resume gives back is the run the
// pause took.
//
// WHY THE WORLD IS POSED AS IT IS. The night is isolated and then given a
// clock, a level, experience, kills, a health short of full, a lamplighter off
// the origin, a loadout, an enemy, a projectile, a puddle, a gem and a pickup,
// because "exactly as the pause left it" is only visible against a run that has
// something in it. The resume is pressed across a frame of `SUB_TICK` seconds,
// because specs/controls.md has a frame's edges read against the screen it
// began on and then "The frame's update ... runs on the screen the edges left:
// a frame whose press enters `playing` ... runs that frame's ticks" — so a
// resume made across a whole tick would hand back a run one tick older, and the
// state the resume ARRIVES at is what this decides. That the resumed run then
// ticks is the pause screen's other half, on `chest-confirm-closes`' pattern.
// The key is a dispatched `KeyP` raised inside the same evaluation as the call,
// so no frame of the build's own real-time loop reads its edge first.
//
// THE TOLERANCE. None: the whole documented run is compared field for field
// against the reading taken while it was paused.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import { BINDINGS } from "../constants";
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

/** The key that pauses and resumes: the first binding of `pause`. */
const PAUSE_KEY = BINDINGS.pause[0]!;

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
  assertEqual(held.screen, "paused", "the screen the resume is pressed on");

  const { after: resumed } = await bracket(h, "advance", [SUB_TICK], {
    hold: PAUSE_KEY,
  });
  await captureStill(h, "resumed");

  assertEqual(resumed.screen, "playing", "the screen the resume left");
  assertDeepEqual(
    documentedRun(resumed.run),
    documentedRun(held.run),
    "the run the resume gives back",
  );
});
