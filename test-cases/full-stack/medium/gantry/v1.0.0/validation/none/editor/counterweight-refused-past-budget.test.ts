// editor/counterweight-refused-past-budget — a counterweight that would take the
// cost past the budget is refused.
//
// `specs/structure.md` § Cost and the budget: "Each site fixes a budget, and the
// cost never exceeds it: an edit that would take the cost past the budget is
// refused." § The editor's rules names the counterweight among the edits that
// rule reaches: "A counterweight placement is refused ... past the budget." And
// "a refused edit changes nothing".
//
// The crane is struts and nothing else, run up to a cost that leaves less than
// `COUNTERWEIGHT_COST` of site 1's `budget` unspent, and the counterweight is then
// placed on a node one of those struts ends at. Every other counterweight rule is
// therefore satisfied — the node is used, it carries nothing — so the budget is
// the only rule that can refuse it. The margin is deliberate: the crane stands
// STRICTLY under the budget, so a build that wrongly refused the last strut at
// exactly the budget would fail its own point rather than pass this one by
// accident.

import { afterEach, beforeEach, it } from "vitest";
import { assertClose, assertEqual, assertLength, assertTrue } from "../assert";
import {
  COUNTERWEIGHT_COST,
  SITES,
  STRUT_COST_PER_UNIT,
  STRUT_MAX_LEN,
} from "../constants";
import { createHarness, emptyYard, openSite, type Harness } from "../harness";

/** Site 1, whose `3000` is the smallest budget the six sites carry. */
const SITE = 0;
const BUDGET = SITES[SITE]!.budget;

/** A strut at its full `STRUT_MAX_LEN`, and a shorter one to trim the total. */
const LONG_COST = STRUT_COST_PER_UNIT * STRUT_MAX_LEN;
const SHORT_LEN = 4;
const SHORT_COST = STRUT_COST_PER_UNIT * SHORT_LEN;

/** Forty-nine long struts and one short: `2980` against a budget of `3000`. */
const LONG_COUNT = 49;
const SPENT = LONG_COUNT * LONG_COST + SHORT_COST;

/** Costs are sums of exact figures, so this is float slop and nothing more. */
const COST_TOL = 1e-6;

/**
 * Horizontal struts of `STRUT_MAX_LEN`, laid in rows across site 1's envelope.
 *
 * Three to a row across `x`, eleven rows across `z`, and as many `y` levels as
 * the count needs — every node a multiple of `LATTICE_PITCH` and inside the
 * envelope, no two struts joining the same two nodes, and none of them at the
 * `y` the short strut takes.
 */
function longStruts(
  count: number,
): readonly (readonly [number, number, number, number, number, number])[] {
  const out: (readonly [number, number, number, number, number, number])[] = [];
  for (const y of [0, 2, 4, 6, 8, 10, 12, 14]) {
    for (let z = -8; z <= 12; z += 2) {
      for (const x of [-8, -2, 4]) {
        if (out.length === count) return out;
        out.push([x, y, z, x + STRUT_MAX_LEN, y, z]);
      }
    }
  }
  return out;
}

/** The one short strut, on a level the long ones never reach. */
const SHORT = [-8, 16, 12, -8 + SHORT_LEN, 16, 12] as const;

/** A node the first long strut ends at, so the structure genuinely uses it. */
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

  for (const [ax, ay, az, bx, by, bz] of longStruts(LONG_COUNT)) {
    await h.debug.addMember(ax, ay, az, bx, by, bz, "strut");
  }
  await h.debug.addMember(
    SHORT[0],
    SHORT[1],
    SHORT[2],
    SHORT[3],
    SHORT[4],
    SHORT[5],
    "strut",
  );

  const built = await h.snapshot();
  assertEqual(
    built.site.budget,
    BUDGET,
    "the budget site 1 fixes (specs/sites.md)",
  );
  assertLength(
    built.structure.members,
    LONG_COUNT + 1,
    "the struts the crane was run up on",
  );
  assertClose(
    built.structure.cost,
    SPENT,
    COST_TOL,
    "the cost the crane stands at, under the budget (specs/structure.md)",
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
