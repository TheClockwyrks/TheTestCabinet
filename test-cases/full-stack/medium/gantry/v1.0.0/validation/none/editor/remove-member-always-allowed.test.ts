// editor/remove-member-always-allowed — removeMember takes a member out whatever
// the placement rules would say.
//
// specs/structure.md: "Removing a member, the ring, or a counterweight is always
// allowed; removal is how a structure that the ring rule would otherwise trap is
// reshaped." No refusal in the editor's list applies to a removal, and the reason
// the specification gives is exactly the situation posed here: a column standing
// between where a ring's bottom flange would sit and where its top flange would sit
// TRAPS the ring, because "A ring placement is refused when ... some path of
// members would run between a bottom-flange or anchor node and a top-flange node".
// The only way out is to take a member out, so a build that refused this removal —
// for the budget, for connectivity, for the shape it leaves — would leave the
// player stuck with a crane they cannot ring.
//
// THE MEMBER REMOVED IS THE TRAPPING ONE. The world is emptied and a straight
// column of struts is raised from the anchor `(0, 0, 0)` through `(0, 2, 0)` and
// `(0, 4, 0)` to `(0, 6, 0)`, which is the bridge across a ring seated at
// `(0, 4, 0)`; the member carrying id `2` is the one that spans the two flange
// squares. Taking it out is read two ways, because a removal is both a member gone
// and the cost of that member given back: "each member's length times its
// material's cost per unit" is `2 * STRUT_COST_PER_UNIT`, so the cost falls by
// `20`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertUndefined } from "../assert";
import { STRUT_COST_PER_UNIT } from "../constants";
import { clearAll, createHarness, openSite, type Harness } from "../harness";

/** The column, anchor upward; each member is two units of strut. */
const COLUMN: readonly (readonly [number, number])[] = [
  [0, 2],
  [2, 4],
  [4, 6],
];

/** The id of the member that spans the flange squares of a ring at `(0,4,0)`. */
const TRAPPING = 2;

/** That member's length, in units. */
const LENGTH = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("removes the member that traps a ring, and gives its cost back", async () => {
  await openSite(h, 0);
  await clearAll(h);
  for (const [from, to] of COLUMN) {
    await h.debug.addMember(0, from, 0, 0, to, 0, "strut");
  }
  const built = (await h.snapshot()).structure;
  assertLength(
    built.members,
    COLUMN.length,
    "the column this check reshapes (specs/structure.md)",
  );

  await h.debug.removeMember(TRAPPING);

  await h.advance(1);
  await h.capture(
    "removed",
    "The column after the trapping member was removed",
  );

  const after = (await h.snapshot()).structure;
  assertUndefined(
    after.members.find((one) => one.id === TRAPPING),
    `the member carrying id ${TRAPPING} after its removal (specs/structure.md)`,
  );
  assertLength(
    after.members,
    COLUMN.length - 1,
    "the members standing after the removal",
  );
  assertEqual(
    built.cost - after.cost,
    LENGTH * STRUT_COST_PER_UNIT,
    "what the removal gives back to the budget (specs/structure.md)",
  );
});
