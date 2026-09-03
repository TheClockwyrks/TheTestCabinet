// passives/spreads-and-ranges-fixed — a spread angle, a scatter radius, and a
// weapon's range are what their constants give, at every passive level.
//
// WHERE THE THRESHOLD COMES FROM. `specs/passives.md`, Area: "Every other
// length a weapon uses is used as written: `SPARK_RANGE`, `OIL_SCATTER`,
// `PIN_SPREAD`, `SHARD_SPREAD`, and `SCONCE_SPREAD`." Three of those are read
// here, each against the figure `specs/weapons.md` gives it and each with
// Glass 5 held, whose `areaMul` of `1.5` would visibly move all three.
//
//   - `PIN_SPREAD` (`10`). Pin's darts start at "`y = player.y + (i − (n − 1)
//     / 2) × PIN_SPREAD`" (`specs/weapons.md`, Pin), so at the level-2 row's
//     `amount` of `2` the two darts sit at `−5` and `+5` from the
//     lamplighter's `y`, ten apart; scaled they would be fifteen apart.
//   - `SPARK_RANGE` (`600`). "Spark's eligible targets are the enemies within
//     `SPARK_RANGE`: with none within it, whatever is alive farther away,
//     Spark does not fire" (`specs/weapons.md`, Spark). A hound `601` units
//     out is outside it and inside the scaled `900`, so a build that scaled
//     the range would land a strike where none may land.
//   - `OIL_SCATTER` (`400`). Each puddle is "centered at an independent
//     uniformly random point of the disk of radius `OIL_SCATTER` (`400`) about
//     the player's center" (`specs/weapons.md`, Oil Splash), so every puddle's
//     center is at most `400` from the lamplighter. Thirty firings are drawn:
//     under a scattered radius of `600` a landing point falls inside `400`
//     with probability `(400 / 600)²`, so thirty of them all falling inside is
//     one chance in ten thousand million.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated run holding Glass 5, Pin at
// level 2, Spark at level 1, and Oil Splash at level 1, with a single hound
// `601` units out. Oil Splash's timer is posed back to `0` before each of the
// thirty ticks, which is how a firing is made to happen on a named tick
// ("`setWeaponCooldown(slot, 0)` makes that the next tick",
// `specs/instrumentation.md`), and nothing else is touched. `effectMotion`
// stays off, so no dart travels to the hound, and `enemyMotion` and
// `enemyContact` stay off, so the hound stands exactly `601` units out for the
// whole watch and never touches the lamplighter, who never moves.
//
// THE TOLERANCE. `MOTION_EPS` on each dart's offset and on each landing
// point's distance, positions the pose fixes exactly; the strike count is a
// whole number, compared exactly.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLessThanOrEqual, assertNear } from "../assert";
import {
  MOTION_EPS,
  OIL_SCATTER,
  PIN_LEVELS,
  PIN_SPREAD,
  SPARK_RANGE,
} from "../constants";
import {
  advanceTicks,
  captureStill,
  createHarness,
  distance,
  enemyById,
  type Harness,
  zonesCreatedSince,
  type SnapshotZone,
  type WickSnapshot,
} from "../harness";
import { fireUnder, slotOf } from "./firing";

/** The Glass level held: `areaMul` `1.5`. */
const GLASS = 5;

/** Pin's level-2 row, whose `amount` is `2`. */
const PIN_ROW = PIN_LEVELS[1];

/** Where the hound stands: one unit outside `SPARK_RANGE`. */
const OUT_OF_RANGE = { x: SPARK_RANGE + 1, y: 0 };

/** Oil Splash firings drawn, each on a tick of its own. */
const FIRINGS = 30;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("keeps Pin's spread at 10, Spark's range at 600, and Oil Splash's scatter within 400 under Glass 5", async () => {
  const firing = await fireUnder(h, {
    passives: [["glass", GLASS]],
    weapons: [
      ["pin", 2],
      ["spark", 1],
      ["oil-splash", 1],
    ],
    enemies: [["hound", OUT_OF_RANGE]],
  });

  const darts = firing.projectiles.filter((p) => p.weapon === "pin");
  assertEqual(
    darts.length,
    PIN_ROW.amount,
    "the darts the firing tick created (specs/weapons.md, Pin)",
  );
  const { player } = firing.after.run;
  darts
    .slice()
    .sort((a, b) => a.y - b.y)
    .forEach((dart, i) => {
      assertNear(
        dart.y - player.y,
        (i - (PIN_ROW.amount - 1) / 2) * PIN_SPREAD,
        MOTION_EPS,
        `dart ${i}: its offset from the lamplighter's y (specs/passives.md, Area)`,
      );
    });

  const oilSlot = slotOf(firing, "oil-splash");
  const puddles: SnapshotZone[] = firing.zones.filter(
    (zone) => zone.kind === "puddle",
  );
  let strikes = firing.zones.filter((zone) => zone.kind === "strike").length;
  let previous: WickSnapshot = firing.after;
  for (let round = 1; round < FIRINGS; round += 1) {
    h.debug.setWeaponCooldown(oilSlot, 0);
    const next = await advanceTicks(h, 1);
    const created = zonesCreatedSince(previous, next);
    puddles.push(...created.filter((zone) => zone.kind === "puddle"));
    strikes += created.filter((zone) => zone.kind === "strike").length;
    previous = next;
  }
  captureStill(h, "fixed");

  assertEqual(
    strikes,
    0,
    "the strikes Spark landed with its only enemy 601 units out (specs/passives.md, Area)",
  );
  assertNear(
    distance(enemyById(previous, firing.targets[0]) ?? { x: NaN, y: NaN }, {
      x: 0,
      y: 0,
    }),
    SPARK_RANGE + 1,
    MOTION_EPS,
    "the hound's distance from the lamplighter across the watch (specs/world.md)",
  );
  assertEqual(
    puddles.length,
    FIRINGS,
    "the puddles the thirty firings landed (specs/weapons.md, Oil Splash)",
  );
  puddles.forEach((puddle, i) => {
    assertLessThanOrEqual(
      distance(puddle, { x: 0, y: 0 }),
      OIL_SCATTER + MOTION_EPS,
      `puddle ${i}: its distance from the lamplighter's center (specs/passives.md, Area)`,
    );
  });
});
