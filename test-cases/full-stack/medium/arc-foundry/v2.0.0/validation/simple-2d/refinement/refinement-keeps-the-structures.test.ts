// refinement/refinement-keeps-the-structures — a purchase leaves every standing structure exactly as it was.
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
// WHAT IS DECIDED HERE is every reported figure of every structure on the yard:
// its damage, range, cadence, abilities, aura radius and bonus, its targeting
// priority and where it stands. `damage` is deliberately among them: refinement
// changes the odds a FUTURE roll draws from and never a standing structure's
// output, so a build that re-derives a standing structure's stats from the live
// refinement level fails here.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { acrossPurchase, stats } from "./unchanged";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("leaves every standing structure's reported stats where they were", async () => {
  const { before, after } = await acrossPurchase(h);
  captureStill(h, "unchanged");

  assertDeepEqual(
    after.structures.map(stats),
    before.structures.map(stats),
    "every standing structure's reported stats, across a refinement " +
      "(specs/scrap-press.md)",
  );
});
