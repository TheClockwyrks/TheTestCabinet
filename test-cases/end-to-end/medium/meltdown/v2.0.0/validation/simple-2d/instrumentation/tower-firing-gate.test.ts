// Meltdown — instrumentation/tower-firing-gate: firing off holds a tower's guns.
//
// specs/instrumentation.md, the faculty gates: `firingEnabled` holds "The tower's
// targeting and firing: acquiring a target, resolving a shot, the damage and splash
// the shot deals, the slow a Rime applies, and the `heatPerShot` the shot adds."
//
// FOUR READINGS, BECAUSE THE GATE HOLDS FOUR THINGS AND A BUILD CAN HOLD FEWER.
// Over one second with a unit standing in range, the gated tower must report
// `firing` false, must have removed no hp from that unit, must have tallied no
// damage, and must have gained no heat. A build that stops the shot but goes on
// acquiring reads `firing` true; one that stops the damage but still runs the fire
// clock gains the `heatPerShot` of every shot it resolved.
//
// AND THE SAME FOUR ARE READ WITH THE GATE ON, on a floor posed identically in
// every other respect, because each of them has a value that a broken build reaches
// by doing nothing at all. A tower that never fires under any circumstances passes
// the gated leg perfectly and fails this one, which is what makes the pair a
// reading of the GATE rather than of a tower that does not work.
//
// THE HEAT IS POSED AT `0`, AND THAT IS WHAT MAKES "NO HEAT" AN EQUALITY.
// specs/heat.md makes air cooling proportional to `H / 100`, so a tower standing in
// open air at heat `0` sheds exactly nothing: with the guns held there is no
// legitimate drift for a bound to have to allow, and the only thing that can move
// this tower's heat over the window is a shot it should not have fired. The thermal
// model is left RUNNING throughout — holding it too would be reading two gates at
// once, and `tower-firing-gate-leaves-the-thermal-model` is the item that reads what
// it leaves behind.
//
// THE MARK CANNOT WALK OR DIE UNDER THE READING: its motion is off so it stays in
// range for the whole window, and its hp ceiling is far past anything a second of
// Arc fire removes, so what the firing leg reads is the DAMAGE DEALT rather than the
// moment the mark died.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertEqual, assertGreaterThan } from "../assert";
import {
  captureStill,
  createHarness,
  poseTarget,
  poseTower,
  startRun,
  ticksFor,
  towerOf,
  unitOf,
  type Harness,
} from "../harness";
import { GUN, MARK } from "./scenes";

/** The emitter read, and the mark its shot would land on. */
const TYPE = "arc";
const HEAT = 0;
const MARK_HP = 1e6;

/** The window each leg is read over: one second of game time. */
const WINDOW_TICKS = ticksFor(1);

/**
 * How closely a held reading must sit at its resting value, as decimal places.
 *
 * Six places is `5e-7`. Nothing in the gated leg may move at all — no shot
 * resolves, so no hp is removed, no damage is tallied, and at heat `0` in open air
 * specs/heat.md's air term is exactly zero — so the only slack a conforming build
 * can need is the representation of the numbers it is not changing. What the bound
 * has to exclude is a single Arc shot, which removes `2.1` hp and adds `10.3` heat
 * (specs/towers.md): seven orders of magnitude clear of it.
 */
const HELD_DIGITS = 6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

/** What one leg of the pair read. */
interface Leg {
  firing: boolean;
  removed: number;
  damageDealt: number;
  heatGain: number;
}

/** Pose the duel with the firing gate as named, run the window, and read it. */
async function legWith(gate: boolean, output: string): Promise<Leg> {
  startRun(h);
  const gun = poseTower(h, TYPE, GUN.col, GUN.row);
  h.debug.setTowerFiring(gun, gate);
  h.debug.setTowerHeat(gun, HEAT);
  const mark = poseTarget(h, "mote", MARK.col, MARK.row, MARK_HP);

  const opened = h.snapshot();
  await h.advance(WINDOW_TICKS);
  const closed = h.snapshot();
  captureStill(h, output);

  return {
    firing: towerOf(closed, gun).firing,
    removed: unitOf(opened, mark).hp - unitOf(closed, mark).hp,
    damageDealt: towerOf(closed, gun).damageDealt,
    heatGain: towerOf(closed, gun).heat - towerOf(opened, gun).heat,
  };
}

it("holds the targeting, the shot, its damage and its heat, and lets all four go again", async () => {
  const held = await legWith(false, "gated");
  assertEqual(held.firing, false, "with firing off: the tower reports firing");
  assertCloseTo(
    held.removed,
    0,
    HELD_DIGITS,
    "with firing off: hp removed from the mark",
  );
  assertCloseTo(
    held.damageDealt,
    0,
    HELD_DIGITS,
    "with firing off: damage tallied",
  );
  assertCloseTo(held.heatGain, 0, HELD_DIGITS, "with firing off: heat gained");

  const firing = await legWith(true, "firing");
  assertEqual(firing.firing, true, "with firing on: the tower reports firing");
  assertGreaterThan(
    firing.removed,
    0,
    "with firing on: hp removed from the mark",
  );
  assertGreaterThan(firing.damageDealt, 0, "with firing on: damage tallied");
  assertGreaterThan(firing.heatGain, 0, "with firing on: heat gained");
});
