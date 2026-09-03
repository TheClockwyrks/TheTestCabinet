// editor/cable-cost-per-unit — a cable costs its length times CABLE_COST_PER_UNIT.
//
// specs/structure.md fixes the sum a crane's cost is: "each member's length times
// its material's cost per unit", and the materials table gives the cable
// `CABLE_COST_PER_UNIT` (`4`) — the cheapest of the three, and the reason a build
// that prices every member alike shows up here rather than on the strut.
//
// THE STRUCTURE IS EMPTIED FIRST so the reading is the cable's alone: cost is a
// sum, and a cost read over a crane that carries anything else measures the sum
// rather than the term. The cable runs from `(0, 0, 0)` to `(0, 4, 0)`, four units
// of the site's own lattice, well inside `CABLE_MAX_LEN` (`24`) and inside
// site 1's envelope, so nothing in the editor's rules refuses it.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { CABLE_COST_PER_UNIT } from "../constants";
import { clearAll, createHarness, openSite, type Harness } from "../harness";

/** The cable this check prices: `(0, 0, 0)` to `(0, 4, 0)`, four units long. */
const LENGTH = 4;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("prices a cable at its length times CABLE_COST_PER_UNIT", async () => {
  await openSite(h, 0);
  await clearAll(h);

  const before = (await h.snapshot()).structure.cost;
  assertEqual(
    before,
    0,
    "the cost of an emptied structure (specs/structure.md)",
  );

  await h.debug.addMember(0, 0, 0, 0, LENGTH, 0, "cable");

  await h.advance(1);
  await h.capture("cost", "The lone cable and the cost it carries");

  const after = (await h.snapshot()).structure;
  assertLength(after.members, 1, "the members the placement left standing");
  assertEqual(
    after.cost,
    LENGTH * CABLE_COST_PER_UNIT,
    `a cable of length ${LENGTH} at CABLE_COST_PER_UNIT (specs/structure.md)`,
  );
});
