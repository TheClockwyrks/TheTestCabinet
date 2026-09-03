// passives/spreads-and-ranges-fixed — a spread, a scatter, and a range are used
// as written whatever Glass is held.
//
// WHERE THE THRESHOLD COMES FROM. specs/passives.md ("Area"): "Every other
// length a weapon uses is used as written: SPARK_RANGE, OIL_SCATTER,
// PIN_SPREAD, SHARD_SPREAD, and SCONCE_SPREAD. The lamplighter's own
// PLAYER_RADIUS and every enemy radius are likewise fixed." With
// GLASS_AREA_PER_LEVEL 0.1, Glass 5 gives areaMul 1.5, which would take
// PIN_SPREAD (10) to 15, SPARK_RANGE (600) to 900, and OIL_SCATTER (400) to 600
// if any of them were scaled.
//   - specs/weapons.md ("Pin"): "dart `i`, counted from 0, starts at
//     `x = player.x` and `y = player.y + (i − (n − 1) / 2) × PIN_SPREAD`", so
//     the two darts of the level-2 row sit at −5 and +5, exactly PIN_SPREAD
//     apart.
//   - specs/weapons.md ("Spark"): "Spark's eligible targets are the enemies
//     within SPARK_RANGE (600) of the player's center: with none within it,
//     whatever is alive farther away, Spark does not fire and its timer is set
//     to its current cooldown", and row 1 gives cooldown 2.0, so a lone enemy
//     at 601 leaves no strike and a timer of 2.0 with no Oil held.
//   - specs/weapons.md ("Oil Splash"): each puddle is "centered at an
//     independent uniformly random point of the disk of radius OIL_SCATTER
//     (400) about the player's center: a distance OIL_SCATTER × sqrt(u) at a
//     uniformly random angle, with `u` uniform on [0, 1)", so every landing
//     point lies within 400 of that center.
//
// THE WORLD. Three isolated playing runs, one per figure, each holding Glass at
// level 5 and nothing else, with every driver switch off but weaponFire.
//   - Pin at level 2, the lowest row whose amount is 2 and so the lowest that
//     has a spread to read, with no enemy posed: "Pin fires whether or not any
//     enemy exists".
//   - Spark at level 1 with one moth 601 units along +x, one unit past the
//     range, and nothing else alive.
//   - Oil Splash at level 1, fired forty times over, each firing armed by
//     posing its timer to 0 and the puddles cleared before the next, so forty
//     independent landing points are sampled from the game's own generator.
//
// WHAT IS READ. The gap between the two darts' `y`, exactly PIN_SPREAD; the
// absence of any strike after Spark's tick together with Spark's timer, which
// is set as though it had fired; and every one of the forty puddles' distance
// from the lamplighter's center, each within OIL_SCATTER.
//
// WHY FORTY PUDDLES. The landing point is random, so one sample decides
// nothing. A build that scattered over the scaled 600 would land inside 400
// with probability (400 / 600)² per puddle, so forty of them agree by chance
// about once in sixty billion runs, while every conformant build passes always.
//
// TOLERANCE. FIGURE_TOLERANCE (1e-9) on the dart gap and on Spark's timer, each
// a stated figure read back as a double. None on the scatter bound: the stated
// distance is OIL_SCATTER × sqrt(u) with u below 1, so a conformant puddle is
// strictly inside it.

import { afterEach, beforeEach, it } from "vitest";
import { assertLength, assertLessThanOrEqual, assertWithin } from "../assert";
import {
  FIGURE_TOLERANCE,
  OIL_SCATTER,
  PIN_LEVELS,
  PIN_SPREAD,
  SPARK_LEVELS,
  SPARK_RANGE,
  cooldownFor,
  type HeldPassives,
} from "../constants";
import {
  captureStill,
  createHarness,
  holdWeapon,
  isolate,
  enable,
  projectilesOf,
  zonesOfKind,
  zonesOf,
  type Harness,
} from "../harness";
import { armAll, holdPassives, probesAround, slotOf, timerOf } from "./night";

/** The passives held: Glass at level 5, whose areaMul is 1.5. */
const HELD: HeldPassives = { glass: 5 };

/** The lowest Pin row whose amount is 2, so it has a spread to read. */
const PIN_LEVEL = 2;

/** The Spark level fired: row 1, cooldown 2.0. */
const SPARK_LEVEL = 1;

/** max(0.2, 2.0 × 1) = 2.0, with no Oil held. */
const SPARK_COOLDOWN = cooldownFor(SPARK_LEVELS[SPARK_LEVEL - 1].cooldown, {});

/** One unit past SPARK_RANGE, where no target is eligible. */
const OUT_OF_RANGE = SPARK_RANGE + 1;

/** How many independent Oil Splash landing points are sampled. */
const SAMPLES = 40;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves PIN_SPREAD, SPARK_RANGE, and OIL_SCATTER as written under Glass 5", async () => {
  isolate(h);
  holdPassives(h, HELD);
  armAll(h, [["pin", PIN_LEVEL]]);
  const pinned = await h.tick(1);
  captureStill(h, "fixed");

  const darts = projectilesOf(pinned, "pin");
  assertLength(
    darts,
    PIN_LEVELS[PIN_LEVEL - 1].amount,
    "Pin darts after the firing tick",
  );
  assertWithin(
    Math.abs(darts[0].y - darts[1].y),
    PIN_SPREAD,
    FIGURE_TOLERANCE,
    "the gap between the two darts, PIN_SPREAD",
  );

  isolate(h);
  holdPassives(h, HELD);
  probesAround(h, "moth", [{ x: OUT_OF_RANGE, y: 0 }]);
  const sparkSlots = armAll(h, [["spark", SPARK_LEVEL]]);
  const sparked = await h.tick(1);

  assertLength(
    zonesOfKind(sparked, "strike"),
    0,
    `strikes with the only enemy ${OUT_OF_RANGE} units out`,
  );
  assertWithin(
    timerOf(sparked, slotOf(sparkSlots, "spark")),
    SPARK_COOLDOWN,
    FIGURE_TOLERANCE,
    "Spark's timer after a tick with no eligible target",
  );

  isolate(h);
  holdPassives(h, HELD);
  const oilSlot = holdWeapon(h, "oil-splash", 1);
  enable(h, "weaponFire");
  for (let sample = 0; sample < SAMPLES; sample += 1) {
    h.debug.setWeaponCooldown(oilSlot, 0);
    const splashed = await h.tick(1);
    const { player } = splashed.run;
    const puddles = zonesOf(splashed, "oil-splash");
    assertLength(puddles, 1, `puddles laid by firing ${sample + 1}`);
    assertLessThanOrEqual(
      Math.hypot(puddles[0].x - player.x, puddles[0].y - player.y),
      OIL_SCATTER,
      `puddle ${sample + 1}: its distance from the lamplighter's center`,
    );
    h.debug.clearZones();
  }
});
