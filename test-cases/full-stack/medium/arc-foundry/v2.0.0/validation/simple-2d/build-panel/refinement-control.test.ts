// build-panel/refinement-control — the level, the next cost, and when it is refused.
//
// `specs/hud.md` gives the panel's refinement control as "the current level `R`,
// and the Charge cost of the next level", "disabled at `R8` and when the next
// level is unaffordable, and by nothing else". `specs/scrap-press.md` holds those
// costs in `REFINEMENT_COSTS`, caps the track at `REFINEMENT_MAX`, and refuses a
// refine "at `R8` and when the player cannot afford the next level".
//
// HOW THE REFUSAL IS READ. `specs/instrumentation.md` reports this control as the
// `refine` row of `pressControls`, and `disabled` there "reports whether it
// currently ignores activation", following "the refinement track alone". So the
// refusal is read off the control itself, at the three points the rule names: one
// rung with its exact price in the bank, the same rung one Charge short, and the
// top rung with Charge to spare. What the panel DRAWS is read alongside it, so a
// build reporting an honest control it never draws fails here too.

import { afterEach, beforeEach, it } from "vitest";
import { assertContains, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  openYard,
  pressControl,
  refinementCost,
  type Harness,
} from "../harness";
import { REFINEMENT_MAX } from "../../src/constants";
import { PANEL, figures } from "./reading";

/** A level whose own figure collides with none of the odds it puts on the panel. */
const LEVEL = 3;
const NEXT_COST = refinementCost(LEVEL + 1);
/** More Charge than the whole track costs, so only the top rung can refuse. */
const PLENTY = 9_000;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("shows the level and the next cost, and refuses at R8 and unaffordable", async () => {
  openYard(h, { refinement: LEVEL, charge: NEXT_COST });

  const drawn = figures(await h.frameCalls(), PANEL);
  captureStill(h, "control");
  assertContains(drawn, LEVEL, `the panel's figures at refinement R${LEVEL}`);
  assertContains(
    drawn,
    NEXT_COST,
    `the panel's figures at refinement R${LEVEL}`,
  );

  // Exactly the price: the control is offered.
  assertEqual(
    pressControl(h, "refine").disabled,
    false,
    `the refinement control at R${LEVEL} with exactly the ${NEXT_COST} the ` +
      "next level costs",
  );

  // One Charge short: refused.
  h.debug.setCharge(NEXT_COST - 1);
  assertEqual(
    pressControl(h, "refine").disabled,
    true,
    `the refinement control at R${LEVEL} one Charge short of ${NEXT_COST}`,
  );

  // The top rung: refused with Charge to spare.
  h.debug.setRefinement(REFINEMENT_MAX);
  h.debug.setCharge(PLENTY);
  assertEqual(
    pressControl(h, "refine").disabled,
    true,
    `the refinement control at R${REFINEMENT_MAX} with ${PLENTY} Charge`,
  );
});
