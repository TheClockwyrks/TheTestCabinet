// build-panel/refinement-control-disabled-unaffordable — the control refuses a level the bank cannot pay for.
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
// HOW THE REFUSAL IS READ. `specs/instrumentation.md` reports this control as the
// `refine` row of `pressControls`, and `disabled` there "reports whether it
// currently ignores activation", following "the refinement track alone". So the
// refusal is read off the control itself rather than off the picture.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  openYard,
  pressControl,
  type Harness,
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

it("reports disabled when the next level is unaffordable", async () => {
  await openYard(h, { refinement: LEVEL, charge: NEXT_COST });
  await captureStill(h, "control");

  // Exactly the price: the control is offered, so the refusal below is the bank's
  // and not the track's.
  assertEqual(
    (await pressControl(h, "refine")).disabled,
    false,
    `the refinement control at R${LEVEL} with exactly the ${NEXT_COST} the ` +
      "next level costs (specs/hud.md)",
  );

  // One Charge short: refused.
  await h.debug.setCharge(NEXT_COST - 1);
  assertEqual(
    (await pressControl(h, "refine")).disabled,
    true,
    `the refinement control at R${LEVEL} one Charge short of ${NEXT_COST} ` +
      "(specs/hud.md)",
  );
});
