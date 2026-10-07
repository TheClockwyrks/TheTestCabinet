// build-panel/refinement-control-reads-level-and-cost — the panel draws the level and the next level's cost.
//
// `specs/hud.md` gives the panel's refinement control as "the current level `R`,
// and the Charge cost of the next level", "disabled at `R8` and when the next
// level is unaffordable, and by nothing else". `specs/scrap-press.md` holds those
// costs in `REFINEMENT_COSTS`, caps the track at `REFINEMENT_MAX`, and refuses a
// refine "at `R8` and when the player cannot afford the next level".
//
// THREE CLAIMS, THREE POINTS. What the panel draws, the refusal at the top of the
// track and the refusal on an empty bank are independent, and the two refusals are
// distinct edge cases of the same rule: a build that stops at `R8` but happily
// offers a level it cannot pay for is a different defect from one that offers `R9`.
// So `refinement-control-reads-level-and-cost`,
// `refinement-control-disabled-at-max` and
// `refinement-control-disabled-unaffordable` are decided by name.
//
// WHAT IS DECIDED HERE is the read: at a level in the middle of the track, both
// the level and the price of the next one appear among the figures the panel drew.

import { afterEach, beforeEach, it } from "vitest";
import { assertContains } from "../assert";
import {
  captureStill,
  createHarness,
  figures,
  type Harness,
  openYard,
  PANEL,
} from "../harness";
import { refinementCost } from "../constants";

/** A level whose own figure collides with none of the odds it puts on the panel. */
const LEVEL = 3;
const NEXT_COST = refinementCost(LEVEL + 1);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws the current refinement level and the next level's cost", async () => {
  await openYard(h, { refinement: LEVEL, charge: NEXT_COST });

  const drawn = figures(await h.frameCalls(), PANEL);
  await captureStill(h, "control");
  assertContains(drawn, LEVEL, `the panel's figures at refinement R${LEVEL}`);
  assertContains(
    drawn,
    NEXT_COST,
    `the panel's figures at refinement R${LEVEL}`,
  );
});
