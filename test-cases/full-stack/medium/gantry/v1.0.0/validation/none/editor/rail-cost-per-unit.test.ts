// editor/rail-cost-per-unit — a rail costs its length times RAIL_COST_PER_UNIT,
// and the trolley it brings into being costs nothing beyond it.
//
// specs/structure.md prices the rail at `RAIL_COST_PER_UNIT` (`18`) per unit in
// the materials table, and says of the carriage the rail creates: "The trolley is
// the carriage the hoist cable hangs from. It exists whenever the structure has
// rail members and is not placed by hand; it costs nothing beyond its rail". So
// the cost of a crane holding one rail and nothing else is exactly the rail's, and
// a build that charged for the trolley as well would read high here.
//
// THE STRUCTURE IS EMPTIED FIRST so the reading is the rail's alone. The rail runs
// from `(0, 4, 0)` to `(4, 4, 0)`: horizontal, as "Every rail member is
// horizontal" requires of a placement, four units long against `RAIL_MAX_LEN`
// (`6`), and inside site 1's envelope. The rest of the track rules are readiness
// rules rather than placement rules and are not judged on a crane with no ring, so
// nothing here refuses the one member this check prices.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { RAIL_COST_PER_UNIT } from "../constants";
import { clearAll, createHarness, openSite, type Harness } from "../harness";

/** The rail this check prices: `(0, 4, 0)` to `(4, 4, 0)`, four units long. */
const LENGTH = 4;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("prices a rail at its length times RAIL_COST_PER_UNIT and no more", async () => {
  await openSite(h, 0);
  await clearAll(h);

  const before = (await h.snapshot()).structure.cost;
  assertEqual(
    before,
    0,
    "the cost of an emptied structure (specs/structure.md)",
  );

  await h.debug.addMember(0, 4, 0, LENGTH, 4, 0, "rail");

  await h.advance(1);
  await h.capture("cost", "The lone rail and the cost it carries");

  const after = (await h.snapshot()).structure;
  assertLength(after.members, 1, "the members the placement left standing");
  assertEqual(
    after.cost,
    LENGTH * RAIL_COST_PER_UNIT,
    `a rail of length ${LENGTH} at RAIL_COST_PER_UNIT, with nothing added for ` +
      "the trolley it creates (specs/structure.md)",
  );
});
