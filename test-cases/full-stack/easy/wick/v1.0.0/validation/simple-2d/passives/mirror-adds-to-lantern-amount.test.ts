// Wick — passives/mirror-adds-to-lantern-amount: Mirror adds `1` per level to
// lantern's amount.
//
// WHERE THE THRESHOLD COMES FROM. `specs/passives.md` ("The derived stats"):
// "`amountBonus = MIRROR_AMOUNT_PER_LEVEL × mirror`" with
// `MIRROR_AMOUNT_PER_LEVEL` (`1`), and ("Amount") "A weapon's amount is its
// table `amount` plus `amountBonus`, so at Mirror level `2` every weapon that
// counts projectiles, puddles, strikes, or lanterns fires two more of them."
// Row 1 of `LANTERN_LEVELS` (`specs/weapons.md`) carries amount `1`, so with
// Mirror at its max level `2` one firing produces `3` lanterns. Every other
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
import { assertLength } from "../assert";
import { derived, type HeldPassives } from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  zonesOf,
  type Harness,
  type Point,
} from "../harness";
import { armAll, holdPassives, probesAround } from "./night";

/** The passives held: Mirror at level 2. */
const HELD: HeldPassives = { mirror: 2 };

/** The level the weapon is held at: row 1, amount 1. */
const LEVEL = 1;

/** 1 + MIRROR_AMOUNT_PER_LEVEL × 2 = 3. */
const AMOUNT = 1 + derived.amountBonus(HELD);

/** The three eligible targets: 120 health each, inside SPARK_RANGE. */
const TARGET = "hound";
const OFFSETS: readonly Point[] = [
  { x: 250, y: 0 },
  { x: -250, y: 0 },
  { x: 0, y: 250 },
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("fires three lanterns with Mirror 2 held", async () => {
  isolate(h);
  holdPassives(h, HELD);
  probesAround(h, TARGET, OFFSETS);
  armAll(h, [["lantern", LEVEL]]);

  const after = await h.tick(1);
  captureStill(h, "amount");

  assertLength(
    zonesOf(after, "lantern"),
    AMOUNT,
    "the lanterns after the firing tick",
  );
});
