// refinement/refinement-keeps-the-vitals — a purchase moves neither Grid Integrity nor the stamp allowance.
//
// specs/scrap-press.md fixes the whole of what refinement does: "Refinement biases
// the press's quality roll", and "Refinement is permanent for the run and changes
// nothing but the quality distribution".
//
// THREE POINTS READ THAT NEGATIVE, grouped by the thing that must not move: the
// standing structures, the run's vitals, and the maze. A build that lets exactly
// one of the three drift must not grade the same as one that lets all three, so
// each is decided by name. `refinement/unchanged.ts` holds the yard they share and
// confirms the purchase really went through.
//
// WHAT IS DECIDED HERE are the two counters a purchase must not touch.
// specs/economy.md lists Grid Integrity as a counter only a leak drains, and
// specs/scrap-press.md gives the stamp allowance to the level rather than to the
// press's odds. Both are posed part-way to a figure that is not the opening one,
// so a build that reset either on a purchase is caught.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { acrossPurchase } from "./unchanged";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves Grid Integrity and the stamp allowance where they were", async () => {
  const { before, after } = await acrossPurchase(h);
  await captureStill(h, "unchanged");

  assertEqual(
    after.integrity,
    before.integrity,
    "Grid Integrity across a refinement (specs/economy.md)",
  );
  assertEqual(
    after.stampsLeft,
    before.stampsLeft,
    "the stamp allowance across a refinement (specs/scrap-press.md)",
  );
});
