// build-panel/refinement-control — the level, the next cost, and when it is refused.
//
// `specs/hud.md` gives the panel's refinement control as "the current level `R`,
// and the Charge cost of the next level", "disabled at `R8` and when the next
// level is unaffordable". `specs/scrap-press.md` holds those costs in
// `REFINEMENT_COSTS`, caps the track at `REFINEMENT_MAX`, and refuses a refine
// "at `R8` and when the player cannot afford the next level".
//
// HOW THE REFUSAL IS READ. No reading reports this control. `panelButtons` covers
// "the build panel inspector's action controls for the selected structure", and
// the refinement control is the panel's own, above the inspector, so it is in
// neither that reading nor `statusControls`. What a disabled control means is
// decided instead from what it does: `upgradeQuality` "buys the next refinement
// level for Charge, as the panel's refinement control does", and
// `specs/instrumentation.md` makes it one of the operations that "commits through
// that same control, so it is refused wherever the control is refused and does
// nothing when it is" — with the refusal readable in the snapshot, where "no
// Charge leaves the bank". Each refusal is read against a commit that DOES go
// through, so a build whose refinement never works fails here rather than passing
// two refusals over.

import { afterEach, beforeEach, it } from "vitest";
import { assertContains, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  openYard,
  type Harness,
} from "../harness";
import { REFINEMENT_MAX, refinementCost } from "../constants";
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

afterEach(async () => {
  await h.dispose();
});

it("shows the level and the next cost, and refuses at R8 and unaffordable", async () => {
  await openYard(h, { refinement: LEVEL, charge: NEXT_COST });

  const drawn = figures(await h.frameCalls(), PANEL);
  await captureStill(h, "control");
  assertContains(drawn, LEVEL, `the panel's figures at refinement R${LEVEL}`);
  assertContains(
    drawn,
    NEXT_COST,
    `the panel's figures at refinement R${LEVEL}`,
  );

  // Exactly the price: the control commits, and takes exactly that much.
  await h.debug.upgradeQuality();
  const bought = await h.snapshot();
  assertEqual(
    bought.refinement,
    LEVEL + 1,
    `the refinement level after buying R${LEVEL + 1} with exactly its cost`,
  );
  assertEqual(
    bought.charge,
    0,
    `the Charge left after buying R${LEVEL + 1} for ${NEXT_COST}`,
  );

  // One Charge short: refused, and nothing leaves the bank.
  await h.debug.setRefinement(LEVEL);
  await h.debug.setCharge(NEXT_COST - 1);
  await h.debug.upgradeQuality();
  const short = await h.snapshot();
  assertEqual(
    short.refinement,
    LEVEL,
    `the refinement level after a refine one Charge short of ${NEXT_COST}`,
  );
  assertEqual(
    short.charge,
    NEXT_COST - 1,
    "the Charge left after a refine that could not be afforded",
  );

  // The top rung: refused with Charge to spare.
  await h.debug.setRefinement(REFINEMENT_MAX);
  await h.debug.setCharge(PLENTY);
  await h.debug.upgradeQuality();
  const capped = await h.snapshot();
  assertEqual(
    capped.refinement,
    REFINEMENT_MAX,
    `the refinement level after a refine at R${REFINEMENT_MAX}`,
  );
  assertEqual(
    capped.charge,
    PLENTY,
    `the Charge left after a refine at R${REFINEMENT_MAX}`,
  );
});
