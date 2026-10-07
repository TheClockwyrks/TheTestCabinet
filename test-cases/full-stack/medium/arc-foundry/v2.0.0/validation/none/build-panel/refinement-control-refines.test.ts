// build-panel/refinement-control-refines — the panel's own control refines the press.
//
// `specs/hud.md` gives the panel its refinement control and says what activating it
// does: "Activating it refines the press whatever is selected. It is the press's
// own control and never the inspector's `UPGRADE`, so the two are activated
// separately and one is never reached by activating the other."
// `specs/instrumentation.md` reports it as the `refine` row of `pressControls`,
// whose `disabled` "follows the refinement track alone", and makes the reported
// rectangle the real hit region: "a press and release at the center of a reported,
// non-disabled rectangle activates that control".
//
// WHATEVER IS SELECTED is the whole of this check. The same rectangle is pressed
// three times, each from a fresh pose, against the three selections that could
// change what it commits: nothing selected, a base component selected, and a
// combination tower selected. One behaviour, read at the three points it could
// break, which is one validator rather than three.
//
// THE COMBINATION TOWER IS THE POINT. A build whose panel wired this rectangle to
// the inspector's `UPGRADE` act passes the first two poses and fails the third,
// where the press is left unrefined and a tower's level is raised instead.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { refinementCost } from "../constants";
import {
  captureStill,
  clickControl,
  createHarness,
  openYard,
  pressControl,
  standCombo,
  standComponent,
  structureById,
  type Harness,
} from "../harness";

/** More Charge than any one act here costs, so nothing is refused for its price. */
const PLENTY = 500;

/** The refinement level each pose starts from, and the cost of leaving it. */
const FROM = 0;
const COST = refinementCost(FROM + 1);

/** Anchors clear of the Substation's chain, entry and collector. */
const COMPONENT = { col: 10, row: 0 };
const TOWER = { col: 14, row: 0 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** Put the press back at `FROM` with the bank full, whatever the last pose spent. */
async function rearm(): Promise<void> {
  await h.debug.setRefinement(FROM);
  await h.debug.setCharge(PLENTY);
}

/** Press the centre of the rectangle the build reported for `refine`. */
async function pressRefine(what: string): Promise<void> {
  const control = await pressControl(h, "refine");
  assertEqual(
    control.disabled,
    false,
    `the refinement control to be offered at R${FROM} with ${PLENTY} Charge, ` +
      `${what} (specs/hud.md)`,
  );
  await clickControl(h, control);
}

it("buys the next refinement level whatever is selected", async () => {
  await openYard(h, { refinement: FROM, charge: PLENTY });

  // Nothing selected.
  await pressRefine("with nothing selected");
  const alone = await h.snapshot();
  assertEqual(
    alone.refinement,
    FROM + 1,
    "the level after a press, unselected",
  );
  assertEqual(alone.charge, PLENTY - COST, "the Charge that press spent");

  // A base component selected.
  await rearm();
  const component = await standComponent(
    h,
    "capacitor",
    1,
    COMPONENT.col,
    COMPONENT.row,
  );
  await h.debug.select(component);
  await pressRefine("with a base component selected");
  const base = await h.snapshot();
  assertEqual(
    base.refinement,
    FROM + 1,
    "the level after a press with a base component selected",
  );
  assertEqual(base.charge, PLENTY - COST, "the Charge that press spent");

  // A combination tower selected: the one selection that could route the press
  // into the inspector's own act instead.
  await rearm();
  const tower = await standCombo(h, "fusecluster", TOWER.col, TOWER.row);
  await h.debug.select(tower);
  const before = structureById(await h.snapshot(), tower).level;
  await pressRefine("with a combination tower selected");
  await captureStill(h, "refine");

  const withTower = await h.snapshot();
  assertEqual(
    withTower.refinement,
    FROM + 1,
    "the level after a press with a combination tower selected: the panel's " +
      "control refines the press whatever is selected (specs/hud.md)",
  );
  assertEqual(
    withTower.charge,
    PLENTY - COST,
    `the Charge that press spent: the refinement cost of ${COST}, and not a ` +
      "tower's upgrade price",
  );
  assertEqual(
    structureById(withTower, tower).level,
    before,
    "the selected tower's level, which the panel's refinement control never " +
      "raises (specs/hud.md)",
  );
});
