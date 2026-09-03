// editor/strut-cost-per-unit — a strut costs its length times STRUT_COST_PER_UNIT.
//
// specs/structure.md fixes the sum a crane's cost is: "A crane's cost is the sum
// of its parts: each member's length times its material's cost per unit, plus
// `RING_COST` for the ring, plus `COUNTERWEIGHT_COST` per counterweight", and the
// materials table gives the strut `STRUT_COST_PER_UNIT` (`10`). So one strut on an
// otherwise empty structure is worth exactly its length times ten, and nothing
// else.
//
// THE STRUCTURE IS EMPTIED FIRST so the reading is the strut's alone: cost is a
// sum, and a cost read over a crane that carries anything else measures the sum
// rather than the term. The strut runs from `(0, 0, 0)` to `(0, 4, 0)`, four units
// of the site's own lattice, which is inside `STRUT_MAX_LEN` (`6`) and inside
// site 1's envelope, so nothing in the editor's rules refuses it and the cost that
// appears is the one the table sets.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { STRUT_COST_PER_UNIT } from "../constants";
import { clearAll, createHarness, openSite, type Harness } from "../harness";

/** The strut this check prices: `(0, 0, 0)` to `(0, 4, 0)`, four units long. */
const LENGTH = 4;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("prices a strut at its length times STRUT_COST_PER_UNIT", async () => {
  await openSite(h, 0);
  await clearAll(h);

  const before = (await h.snapshot()).structure.cost;
  assertEqual(
    before,
    0,
    "the cost of an emptied structure (specs/structure.md)",
  );

  await h.debug.addMember(0, 0, 0, 0, LENGTH, 0, "strut");

  await h.advance(1);
  await h.capture("cost", "The lone strut and the cost it carries");

  const after = (await h.snapshot()).structure;
  assertLength(after.members, 1, "the members the placement left standing");
  assertEqual(
    after.cost,
    LENGTH * STRUT_COST_PER_UNIT,
    `a strut of length ${LENGTH} at STRUT_COST_PER_UNIT (specs/structure.md)`,
  );
});
