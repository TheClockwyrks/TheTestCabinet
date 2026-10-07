// Refract — cascade/generated-crystal-charges-in-range: every generated crystal carries a legal charge count.
//
// specs/modes/cascade.md "The generator": a crystal's charges are 1 to MAX_CHARGES (3),
// "never above MAX_CHARGES". The narrower range a TIER states is
// cascade/tier-crystal-count-and-charges's point; here the subject is the
// generator's outer bound, which no tier may cross.
//
// The generator is asked for five boards at every tier through `generateBoard`
// (specs/instrumentation.md), and every arrived board is held against that
// row of the contract; the last MAX_TIER board is kept as the picture.

import { afterEach, beforeEach, it } from "vitest";
import {
  captureStill,
  createHarness,
  generateAtTiers,
  resetTo,
  type Harness,
} from "../harness";
import { MAX_TIER } from "../notation";
import { assertCrystalChargesInRange } from "./helpers";

const PER_TIER = 5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("emits only crystals carrying 1 to MAX_CHARGES charges, five boards at every tier", async () => {
  await resetTo(h);
  await generateAtTiers(h, PER_TIER, ({ tier, round, board }) => {
    if (tier === MAX_TIER && round === PER_TIER) captureStill(h, "charges");
    assertCrystalChargesInRange(board, `tier ${tier}, board ${round}`);
  });
});
