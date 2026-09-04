// Wick — passives/mirror-adds-to-shard-amount: Mirror adds `1` per level to
// shard's amount.
//
// WHERE THE THRESHOLD COMES FROM. `specs/passives.md` ("The derived stats"):
// "`amountBonus = MIRROR_AMOUNT_PER_LEVEL × mirror`" with
// `MIRROR_AMOUNT_PER_LEVEL` (`1`), and ("Amount") "A weapon's amount is its
// table `amount` plus `amountBonus`, so at Mirror level `2` every weapon that
// counts projectiles, puddles, strikes, or lanterns fires two more of them."
// Row 1 of `SHARD_LEVELS` (`specs/weapons.md`) carries amount `1`, so with
// Mirror at its max level `2` one firing produces `3` shards. Every other
// weapon Mirror raises is a point of its own.
//
// THE POSE. An isolated night with Mirror 2 held through `setPassive` and
// three hounds on a ring `500` units out, one per shape an amount of three
// needs: "With amount `n`, `n` bolts fire on the same tick, one at each of the
// `n` nearest distinct enemies, fewer when fewer enemies exist" (Ember), and
// Spark strikes "on a distinct enemy chosen uniformly at random among the live
// enemies within `SPARK_RANGE` (`600`)". A hound's `hp` is `120`
// (`specs/enemies.md`), which no shape of this tick takes to `0`, and `500` is
// clear of every shape created at the lamplighter's center. Every other
// faculty stays held.
//
// TOLERANCE. None: the reading is a count of the shapes one tick created.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { SHARD_LEVELS, amountBonus } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { fireUnder, type Post } from "./firing";

/** The Mirror level held: `amountBonus` `2`. */
const MIRROR = 2;

/** The amount the level-1 row's `1` becomes under Mirror 2: `3`. */
const AMOUNT = SHARD_LEVELS[0].amount + amountBonus(MIRROR);

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

it("fires three shards under Mirror 2", async () => {
  const firing = await fireUnder(h, {
    passives: [["mirror", MIRROR]],
    weapons: [["shard", 1]],
    enemies: POSTS,
  });
  captureStill(h, "amount");

  assertEqual(
    firing.projectiles.filter((p) => p.weapon === "shard").length,
    AMOUNT,
    "the shards one level-1 firing created under Mirror 2 (specs/passives.md, Amount)",
  );
});
