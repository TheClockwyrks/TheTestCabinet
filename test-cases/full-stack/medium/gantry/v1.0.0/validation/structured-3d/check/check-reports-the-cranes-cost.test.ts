// check/check-reports-the-cranes-cost — the check reports the crane's cost.
//
// specs/structure.md § Cost and the budget: "A crane's cost is the sum of its
// parts: each member's length times its material's cost per unit, plus
// `RING_COST` for the ring, plus `COUNTERWEIGHT_COST` per counterweight." § The
// static check reports that figure, and specs/instrumentation.md ties it to the
// snapshot's: `structure.cost` is "derived from the rules in
// `specs/structure.md`", and `check` "reports exactly what the `check` action
// reports".
//
// THE CRANE IS ARITHMETIC RATHER THAN A STRUCTURE. One member of each material,
// each four units long, so every term of the sum is present and each is a
// different rate:
//
//   strut  4 * STRUT_COST_PER_UNIT  (10)  =  40
//   cable  4 * CABLE_COST_PER_UNIT  ( 4)  =  16
//   rail   4 * RAIL_COST_PER_UNIT   (18)  =  72
//   ring                RING_COST         = 300
//   one counterweight   COUNTERWEIGHT_COST=  40
//                                          ----
//                                            468
//
// A build that priced every member alike, or left the ring or the counterweight
// out, lands on a different figure. Site 2's budget is `3600` (specs/sites.md),
// so nothing here is refused for cost, and the ring goes on first at `(0, 2, 0)`
// — its base corner's `y` is not `0`, as § The editor's rules requires — so each
// member hangs off the top flange and none of them joins the arm to the tower.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  CABLE_COST_PER_UNIT,
  COUNTERWEIGHT_COST,
  RAIL_COST_PER_UNIT,
  RING_COST,
  STRUT_COST_PER_UNIT,
} from "../constants";
import { createHarness, openSite, type Harness } from "../harness";

/** Turnabout, whose `3600` budget none of this reaches. */
const SITE = 1;

/** The one length every member here is placed at. */
const LEN = 4;

const EXPECTED =
  LEN * STRUT_COST_PER_UNIT +
  LEN * CABLE_COST_PER_UNIT +
  LEN * RAIL_COST_PER_UNIT +
  RING_COST +
  COUNTERWEIGHT_COST;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("adds up the members, the ring and the counterweight", async () => {
  await openSite(h, SITE);
  // The precondition is an empty structure and nothing else. A site opened
  // after a reset already carries one (specs/state.md), and `clearStructure`
  // states it rather than leaving it implied; emptying the yard and the tape
  // too would drive surface this requirement does not concern.
  await h.debug.clearStructure();

  await h.debug.setRing(0, 2, 0);
  await h.debug.addMember(0, 4, 0, 0, 8, 0, "strut");
  await h.debug.addMember(2, 4, 0, 2, 8, 0, "cable");
  await h.debug.addMember(0, 4, 2, 4, 4, 2, "rail");
  await h.debug.addCounterweight(0, 8, 0);

  const result = await h.check();
  const { structure } = await h.snapshot();
  await h.advance(1);
  await h.capture(
    "cost-structure-cost-structure-members",
    "cost, structure.cost, structure.members.",
  );

  assertEqual(
    structure.members.length,
    3,
    "the three members this crane places, one of each material",
  );
  assertEqual(
    result.cost,
    EXPECTED,
    `the crane's cost: ${LEN} * ${STRUT_COST_PER_UNIT} + ${LEN} * ` +
      `${CABLE_COST_PER_UNIT} + ${LEN} * ${RAIL_COST_PER_UNIT} + ` +
      `${RING_COST} + ${COUNTERWEIGHT_COST} (specs/structure.md § Cost and ` +
      "the budget)",
  );
  assertEqual(
    result.cost,
    structure.cost,
    "the cost the check reports, against the crane's cost the snapshot " +
      "carries (specs/structure.md § The static check)",
  );
});
