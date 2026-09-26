// editor/member-refused-past-budget — a member that would take the cost past the
// budget is refused.
//
// specs/structure.md: "Each site fixes a budget, and the cost never exceeds it: an
// edit that would take the cost past the budget is refused." The budget is the
// whole of the puzzle's economy — a build that let a placement overrun it would let
// a player buy their way past every site — and the refusal is silent, so the reading
// is the structure the attempt left: no member appeared, and no cost was spent.
//
// THE CRANE IS SPENT UP TO `2980` OF SITE 1'S `3000` (specs/sites.md), leaving
// `20`, and the member attempted is worth `40`. The spending is thirty-six cables
// running the width of the envelope from `(-8, y, z)` to `(12, y, z)` — twenty
// units, inside `CABLE_MAX_LEN` (`24`), `80` apiece — two four-unit struts and one
// two-unit strut, at `STRUT_COST_PER_UNIT` (`10`) a unit. The member under test is
// a four-unit strut from the anchor `(0, 0, 2)` up to `(0, 4, 2)`: inside
// `STRUT_MAX_LEN` (`6`), inside the envelope, on a pair of nodes nothing else
// joins, in an emptied yard with no obstacle to reach into, and with no ring on the
// crane so nothing can refuse it for joining the arm to the tower. The budget is
// the only rule left with anything to say.

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

/** The filler struts, each `[x, z, length]`, standing from an anchor. */
const STRUTS: readonly (readonly [number, number, number])[] = [
  [0, 0, 4],
  [2, 0, 4],
  [0, 2, 2],
];

/** What stands before the edit under test: `2980` of the `3000`. */
const SPENT =
  CABLES * CABLE_COST +
  STRUTS.reduce((sum, [, , length]) => sum + length * STRUT_COST_PER_UNIT, 0);

/** The member under test: four units of strut, `40`, on `20` of budget left. */
const LENGTH = 4;
const COST = LENGTH * STRUT_COST_PER_UNIT;
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

it("refuses a member whose cost would overrun the budget", async () => {
  await openSite(h, 0);
  await clearAll(h);
  assertEqual(
    (await h.snapshot()).site.budget,
    BUDGET,
    "site 1's budget (specs/sites.md)",
  );

  await spend(h, CABLES);
  for (const [x, z, length] of STRUTS) {
    await h.debug.addMember(x, 0, z, x, length, z, "strut");
  }
  const before = (await h.snapshot()).structure;
  assertEqual(before.cost, SPENT, "the cost this check spends up to");
  assertEqual(
    SPENT + COST > BUDGET,
    true,
    "the placement under test would carry the cost past the budget",
  );

  await h.debug.addMember(
    UNDER_TEST.x,
    0,
    UNDER_TEST.z,
    UNDER_TEST.x,
    LENGTH,
    UNDER_TEST.z,
    "strut",
  );

  await h.advance(1);
  await h.capture(
    "refused",
    "The crane after the unaffordable member was refused",
  );

  const after = (await h.snapshot()).structure;
  assertLength(
    after.members,
    before.members.length,
    `the members standing after a placement that would take the cost from ` +
      `${SPENT} to ${SPENT + COST}, past the budget of ${BUDGET} ` +
      "(specs/structure.md)",
  );
  assertEqual(
    after.cost,
    SPENT,
    "the cost after the refused placement (specs/structure.md)",
  );
});
