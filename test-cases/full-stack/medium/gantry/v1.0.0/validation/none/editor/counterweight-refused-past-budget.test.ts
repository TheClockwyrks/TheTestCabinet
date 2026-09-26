// editor/counterweight-refused-past-budget — a counterweight that would take the
// cost past the budget is refused.
//
// `specs/structure.md` § Cost and the budget: "Each site fixes a budget, and the
// cost never exceeds it: an edit that would take the cost past the budget is
// refused." § The editor's rules names the counterweight among the edits that
// rule reaches: "A counterweight placement is refused ... past the budget." And
// "a refused edit changes nothing".
//
// THE CRANE IS RUN UP TO THE BUDGET IN AS FEW EDITS AS THE BUDGET ALLOWS. The
// dearest member a site can carry is a rail at its full `RAIL_MAX_LEN`, `108` of
// site 1's `3000`, so twenty-seven of them and one cable to trim the total stand
// the cost at `2964` — twenty-eight edits rather than the fifty a cheaper member
// would need, and every one of them a placement the editor accepts. What is left
// unspent, `36`, is less than `COUNTERWEIGHT_COST` (`40`), so the counterweight
// placed next is one the budget cannot pay for.
//
// The counterweight then goes on a node one of those rails ends at. Every other
// counterweight rule is therefore satisfied — the node is used, it carries
// nothing — so the budget is the only rule that can refuse it. The margin is
// deliberate: the crane stands STRICTLY under the budget, so a build that wrongly
// refused the last member at exactly the budget would fail its own point rather
// than pass this one by accident.

import { afterEach, beforeEach, it } from "vitest";
import { assertClose, assertEqual, assertLength, assertTrue } from "../assert";
import {
  CABLE_COST_PER_UNIT,
  COUNTERWEIGHT_COST,
  RAIL_COST_PER_UNIT,
  RAIL_MAX_LEN,
  SITES,
} from "../constants";
import { createHarness, emptyYard, openSite, type Harness } from "../harness";

/** Site 1, whose `3000` is the smallest budget the six sites carry. */
const SITE = 0;
const BUDGET = SITES[SITE]!.budget;

/** A rail at its full `RAIL_MAX_LEN`: `108`, the dearest single edit there is. */
const RAIL_COST = RAIL_COST_PER_UNIT * RAIL_MAX_LEN;
const RAIL_COUNT = 27;

/** One cable to trim the total to just under the budget: `48`. */
const CABLE_LEN = 12;
const CABLE_COST = CABLE_COST_PER_UNIT * CABLE_LEN;

/** `2964` against a budget of `3000`, over twenty-eight edits. */
const SPENT = RAIL_COUNT * RAIL_COST + CABLE_COST;
const MEMBERS = RAIL_COUNT + 1;

/** Costs are sums of exact figures, so this is float slop and nothing more. */
const COST_TOL = 1e-6;

/**
 * Twenty-seven horizontal rails of `RAIL_MAX_LEN`, laid across site 1's floor.
 *
 * Three to a row across `x` and nine rows across `z`, every node a multiple of
 * `LATTICE_PITCH` and inside the envelope (`x -8..12`, `y 0..16`, `z -8..12`),
 * every one horizontal as `specs/structure.md` requires of a rail, and no two
 * joining the same two nodes. The crane carries no ring, so the rule about
 * joining the arm to the tower has no flange node to fire on.
 */
function rails(
  count: number,
): readonly (readonly [number, number, number, number, number, number])[] {
  const out: (readonly [number, number, number, number, number, number])[] = [];
  for (let z = -8; z <= 8; z += 2) {
    for (const x of [-8, -2, 4]) {
      if (out.length === count) return out;
      out.push([x, 0, z, x + RAIL_MAX_LEN, 0, z]);
    }
  }
  return out;
}

/** The one cable, on a level the rails never reach. */
const CABLE = [-8, 16, 12, -8 + CABLE_LEN, 16, 12] as const;

/** A node the first rail ends at, so the structure genuinely uses it. */
const USED = { x: -8, y: 0, z: -8 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("refuses a counterweight the budget cannot pay for", async () => {
  await openSite(h, SITE);
  await emptyYard(h);

  for (const [ax, ay, az, bx, by, bz] of rails(RAIL_COUNT)) {
    await h.debug.addMember(ax, ay, az, bx, by, bz, "rail");
  }
  await h.debug.addMember(
    CABLE[0],
    CABLE[1],
    CABLE[2],
    CABLE[3],
    CABLE[4],
    CABLE[5],
    "cable",
  );

  const built = await h.snapshot();
  assertEqual(
    built.site.budget,
    BUDGET,
    "the budget site 1 fixes (specs/sites.md)",
  );
  assertLength(
    built.structure.members,
    MEMBERS,
    "the members the crane was run up on",
  );
  assertClose(
    built.structure.cost,
    SPENT,
    COST_TOL,
    "the cost the crane stands at, under the budget (specs/structure.md)",
  );
  assertTrue(
    SPENT < BUDGET,
    "the crane standing strictly under the budget, so no edit of it was one " +
      "the budget itself refused",
  );
  assertTrue(
    SPENT + COUNTERWEIGHT_COST > BUDGET,
    "a counterweight here would take the cost past the budget",
  );

  await h.debug.addCounterweight(USED.x, USED.y, USED.z);

  const s = await h.snapshot();
  await h.advance(1);
  await h.capture("refused", "The crane at the budget, carrying no block");

  assertLength(
    s.structure.counterweights,
    0,
    "the counterweights a budget that cannot pay for one accepts " +
      "(specs/structure.md)",
  );
  assertClose(
    s.structure.cost,
    SPENT,
    COST_TOL,
    "the cost a refused edit leaves: it changes nothing " +
      "(specs/structure.md)",
  );
});
