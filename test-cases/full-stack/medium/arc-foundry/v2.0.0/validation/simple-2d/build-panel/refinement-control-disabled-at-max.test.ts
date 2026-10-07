// build-panel/refinement-control-disabled-at-max — the control refuses at the top of the track.
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
import { REFINEMENT_MAX } from "../constants";

/** A level whose own figure collides with none of the odds it puts on the panel. */
const LEVEL = 3;
/** More Charge than the whole track costs, so only the top rung can refuse. */
const PLENTY = 9_000;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("reports disabled at the top of the refinement track", async () => {
  openYard(h, { refinement: LEVEL, charge: PLENTY });

  // Below the top with Charge to spare: the control is offered, so the refusal
  // below is the track's and not the bank's.
  assertEqual(
    pressControl(h, "refine").disabled,
    false,
    `the refinement control at R${LEVEL} with ${PLENTY} Charge (specs/hud.md)`,
  );

  h.debug.setRefinement(REFINEMENT_MAX);
  captureStill(h, "control");
  assertEqual(
    pressControl(h, "refine").disabled,
    true,
    `the refinement control at R${REFINEMENT_MAX} with ${PLENTY} Charge, ` +
      "which is the top of the track (specs/hud.md)",
  );
});
