// passives/amount-bonus-on-evolved — amountBonus reads an evolved weapon's
// fixed row exactly as it reads a base weapon's table row.
//
// WHERE THE THRESHOLD COMES FROM. specs/passives.md ("The derived stats"): "An
// evolved weapon's single stat row passes through damageMul, cooldownMul,
// areaMul, and amountBonus exactly as a base weapon's table row does", with
// amountBonus = MIRROR_AMOUNT_PER_LEVEL × mirror and MIRROR_AMOUNT_PER_LEVEL 1,
// so Mirror 1 gives 1. specs/evolutions.md ("Passives still apply") says the
// same: "amount is the fixed amount plus `amountBonus`". BLAZE_STATS gives
// amount 5 (specs/evolutions.md, "Blaze"), so one firing lays 5 + 1 = 6
// puddles.
//
// THE WORLD. An isolated playing run: nothing on the field, Mirror at level 1
// in the first passive slot, Blaze alone with its timer at 0, and every driver
// switch off but weaponFire. "Blaze fires whether or not any enemy exists", so
// no enemy is posed and the puddles pulse on nothing.
//
// WHAT IS READ. The number of Blaze puddles after the firing tick, 6. Where
// they landed is not read: each landing point is drawn at random from the
// game's generator.
//
// TOLERANCE. None: an amount is a whole count.

import { afterEach, beforeEach, it } from "vitest";
import { assertLength } from "../assert";
import { BLAZE_STATS, derived, type HeldPassives } from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  zonesOf,
  type Harness,
} from "../harness";
import { armAll, holdPassives } from "./night";

/** The passives held: Mirror at level 1. */
const HELD: HeldPassives = { mirror: 1 };

/** 5 + 1 × 1 = 6. */
const AMOUNT = BLAZE_STATS.amount + derived.amountBonus(HELD);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("lays six Blaze puddles on one firing with Mirror 1 held", async () => {
  isolate(h);
  holdPassives(h, HELD);
  armAll(h, [["blaze", 1]]);

  const after = await h.tick(1);
  captureStill(h, "evolved");

  assertLength(
    zonesOf(after, "blaze"),
    AMOUNT,
    "Blaze puddles after the firing tick",
  );
});
