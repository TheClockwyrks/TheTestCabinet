// refinement/refinement-keeps-the-maze — a purchase changes no tile, so the route is the length it was.
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
// WHAT IS DECIDED HERE is the maze. specs/pathing.md fixes what may change a tile
// — "The walls change in exactly two ways: a rock is placed, and a structure is
// dismantled" — and says outright that "refining the press ... touch no tile", so
// the route length has to come through a purchase unmoved.

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

it("leaves the maze length where it was", async () => {
  const { before, after } = await acrossPurchase(h);
  await captureStill(h, "unchanged");

  assertEqual(
    after.mazeLength,
    before.mazeLength,
    "the maze length across a refinement: refining touches no tile " +
      "(specs/pathing.md)",
  );
});
