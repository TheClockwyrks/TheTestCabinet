// passives/mirror-adds-to-amount — Mirror adds one per level to every weapon's
// amount.
//
// WHERE THE THRESHOLD COMES FROM. `specs/passives.md` gives the term and the
// formula: `MIRROR_AMOUNT_PER_LEVEL` is `1`, and
// "amountBonus = MIRROR_AMOUNT_PER_LEVEL × mirror", so Mirror 2 is `2`. The
// Amount section applies it: "A weapon's amount is its table `amount` plus
// `amountBonus`, so at Mirror level `2` every weapon that counts projectiles,
// puddles, strikes, or lanterns fires two more of them." Every level-1 row
// carries `amount` `1` (`specs/weapons.md`), so each of the seven weapons that
// counts shapes fires `3`.
//
// WHICH WEAPONS ARE READ. The seven whose stat row carries an `amount` and
// whose shapes are counted one by one: Ember, Pin, Lantern, Oil Splash, Spark,
// Shard, and Sconce. "Halo, Corona, and Flare have no amount and ignore
// `amountBonus`", and Taper's amount is capped at `TAPER_MAX_AMOUNT`
// (`specs/passives.md`, Amount), so none of those four is read here.
//
// WHY THERE ARE TWO FIRINGS. `WEAPON_SLOTS` is `6` (`specs/progression.md`),
// so seven weapons do not fit one loadout; six fire on the first isolated run
// and Sconce on a second, each arranged the same way.
//
// WHY THE WORLD IS POSED AS IT IS. Four hounds, each between three hundred and
// four hundred and fifty units out and every one inside `SPARK_RANGE` (`600`).
// Ember fires "one at each of the `n` nearest distinct enemies, fewer when
// fewer enemies exist" and Spark strikes "`amount` strikes ... each on a
// distinct enemy chosen uniformly at random among the live enemies within
// `SPARK_RANGE`", so four candidates for an amount of three make the count the
// amount rather than the roster. A hound's `120` hp (`specs/enemies.md`)
// outlasts every hit the tick can land, so none of the four disappears
// mid-tick. `effectMotion` stays off, so nothing travels, and every other
// switch but `weaponFire` stays off.
//
// THE TOLERANCE. Counts of shapes, whole numbers compared exactly.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  EMBER_LEVELS,
  LANTERN_LEVELS,
  OIL_SPLASH_LEVELS,
  PIN_LEVELS,
  SCONCE_LEVELS,
  SHARD_LEVELS,
  SPARK_LEVELS,
  amountBonus,
} from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { FAR_POST, fireUnder, type Post } from "./firing";

/** The Mirror level held: `amountBonus` `2`. */
const MIRROR = 2;

/** The amount each level-1 row's `1` becomes under Mirror 2: `3`. */
const AMOUNT = 1 + amountBonus(MIRROR);

/** Four hounds, all inside `SPARK_RANGE`, at four distinct distances. */
const POSTS: readonly Post[] = [
  ["hound", { x: 300, y: 0 }],
  ["hound", { x: 0, y: 350 }],
  ["hound", { x: -400, y: 0 }],
  ["hound", { x: 0, y: -450 }],
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("fires three of every counted shape under Mirror 2", async () => {
  for (const row of [
    EMBER_LEVELS[0],
    PIN_LEVELS[0],
    LANTERN_LEVELS[0],
    OIL_SPLASH_LEVELS[0],
    SPARK_LEVELS[0],
    SHARD_LEVELS[0],
    SCONCE_LEVELS[0],
  ]) {
    assertEqual(row.amount, 1, "the amount each level-1 row gives");
  }

  const six = await fireUnder(h, {
    passives: [["mirror", MIRROR]],
    weapons: [
      ["ember", 1],
      ["pin", 1],
      ["lantern", 1],
      ["oil-splash", 1],
      ["spark", 1],
      ["shard", 1],
    ],
    enemies: POSTS,
  });
  captureStill(h, "amount");

  const counts: readonly [string, number][] = [
    ["Ember bolts", six.projectiles.filter((p) => p.weapon === "ember").length],
    ["Pin darts", six.projectiles.filter((p) => p.weapon === "pin").length],
    ["shards", six.projectiles.filter((p) => p.weapon === "shard").length],
    ["lanterns", six.zones.filter((z) => z.kind === "lantern").length],
    ["puddles", six.zones.filter((z) => z.kind === "puddle").length],
    ["strikes", six.zones.filter((z) => z.kind === "strike").length],
  ];
  for (const [what, count] of counts) {
    assertEqual(
      count,
      AMOUNT,
      `the ${what} one level-1 firing created under Mirror 2 (specs/passives.md, Amount)`,
    );
  }

  const sconce = await fireUnder(h, {
    passives: [["mirror", MIRROR]],
    weapons: [["sconce", 1]],
    enemies: [["hound", FAR_POST]],
  });
  assertEqual(
    sconce.projectiles.filter((p) => p.weapon === "sconce").length,
    AMOUNT,
    "the sconces one level-1 firing launched under Mirror 2 (specs/passives.md, Amount)",
  );
});
