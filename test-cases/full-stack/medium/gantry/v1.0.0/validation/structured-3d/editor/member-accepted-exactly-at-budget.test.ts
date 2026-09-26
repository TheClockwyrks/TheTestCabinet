// editor/member-accepted-exactly-at-budget — a member that brings the cost exactly
// to the budget is accepted.
//
// specs/structure.md draws the line one side of equality: "the cost never exceeds
// it: an edit that would take the cost past the budget is refused." An edit that
// lands ON the budget takes the cost nowhere past it, so it stands — and the last
// unit of a site's budget is money the player is meant to be able to spend. This
// is the edge case a build that refuses on `cost + edit >= budget`, or that keeps a
// margin of its own, gets wrong while every cheaper placement still lands.
//
// THE CRANE IS SPENT UP TO `2960` OF SITE 1'S `3000` (specs/sites.md), leaving
// exactly `40`, and the member placed is worth exactly `40`. The spending is
// thirty-six cables running the width of the envelope from `(-8, y, z)` to
// `(12, y, z)` — twenty units, inside `CABLE_MAX_LEN` (`24`), `80` apiece — and two
// four-unit struts, `4 * STRUT_COST_PER_UNIT` (`40`) apiece. The member under test
// is a third such strut, from the anchor `(0, 0, 2)` up to `(0, 4, 2)`: inside
// `STRUT_MAX_LEN` (`6`), inside the envelope, on a pair of nodes nothing else
// joins, in an emptied yard with no obstacle to reach into, and with no ring on the
// crane so nothing can refuse it for joining the arm to the tower. The budget is
// the only rule left with anything to say, and it says yes.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import {
  CABLE_COST_PER_UNIT,
  LATTICE_PITCH,
  STRUT_COST_PER_UNIT,
} from "../constants";
import { clearAll, createHarness, openSite, type Harness } from "../harness";

/** Site 1's budget (specs/sites.md). */
const BUDGET = 3000;

/** One filler cable: the envelope's width, `x -8` to `x 12`. */
const CABLE_COST = 20 * CABLE_COST_PER_UNIT;
const CABLES = 36;

/** One filler strut: four units, standing from an anchor. */
const STRUT_LENGTH = 4;
const STRUT_COST = STRUT_LENGTH * STRUT_COST_PER_UNIT;
const STRUTS: readonly (readonly [number, number])[] = [
  [0, 0],
  [2, 0],
];

/** What stands before the edit under test: `2960` of the `3000`. */
const SPENT = CABLES * CABLE_COST + STRUTS.length * STRUT_COST;

/** The member under test: the third strut, on the anchor `(0, 0, 2)`. */
const UNDER_TEST = { x: 0, z: 2 };

/** Distinct cables spanning site 1's envelope, `count` of them. */
async function spend(h: Harness, count: number): Promise<void> {
  let placed = 0;
  for (let y = 0; y <= 16 && placed < count; y += LATTICE_PITCH) {
    for (let z = -8; z <= 12 && placed < count; z += LATTICE_PITCH) {
      await h.debug.addMember(-8, y, z, 12, y, z, "cable");
      placed += 1;
    }
  }
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("places a member whose cost lands exactly on the budget", async () => {
  await openSite(h, 0);
  await clearAll(h);
  assertEqual(
    (await h.snapshot()).site.budget,
    BUDGET,
    "site 1's budget (specs/sites.md)",
  );

  await spend(h, CABLES);
  for (const [x, z] of STRUTS) {
    await h.debug.addMember(x, 0, z, x, STRUT_LENGTH, z, "strut");
  }
  const before = (await h.snapshot()).structure;
  assertEqual(before.cost, SPENT, "the cost this check spends up to");
  assertEqual(
    SPENT + STRUT_COST,
    BUDGET,
    "the placement under test lands exactly on the budget",
  );

  await h.debug.addMember(
    UNDER_TEST.x,
    0,
    UNDER_TEST.z,
    UNDER_TEST.x,
    STRUT_LENGTH,
    UNDER_TEST.z,
    "strut",
  );

  await h.advance(1);
  await h.capture("at-budget", "The crane standing at exactly its budget");

  const after = (await h.snapshot()).structure;
  assertLength(
    after.members,
    before.members.length + 1,
    "the members standing after a placement that lands on the budget " +
      "(specs/structure.md)",
  );
  assertEqual(
    after.cost,
    BUDGET,
    "the cost of a crane built exactly to its budget (specs/structure.md)",
  );
});
