// editor/ring-refused-past-budget — a ring that would take the cost past the
// budget is refused.
//
// specs/structure.md: "Each site fixes a budget, and the cost never exceeds it: an
// edit that would take the cost past the budget is refused", and the ring's own
// list of refusals ends with the same rule — "A ring placement is refused when ...
// it would take the cost past the budget." The ring is the single most expensive
// edit in the game, `RING_COST` (`300`), so it is the edit a build that checks the
// budget for members alone lets through.
//
// THE CRANE IS SPENT UP TO `2800` OF SITE 1'S `3000` (specs/sites.md), with
// `200` left and a ring wanting `300`. The spending is thirty-five cables, each
// running the width of the envelope from `(-8, y, z)` to `(12, y, z)`: twenty units
// long, inside `CABLE_MAX_LEN` (`24`), horizontal, on distinct node pairs, and
// worth `20 * CABLE_COST_PER_UNIT` (`80`) apiece. None of them ends on a flange
// node of the ring this check then tries to seat, and members "connect only where
// they share an end node", so no path of members can run between the ring's
// flanges and the arm-to-tower rule has nothing to say.
//
// EVERY OTHER RING RULE IS SATISFIED at the corner `(4, 4, 4)`: the crane has no
// ring, all eight flange nodes lie inside `x -8..12`, `y 0..16`, `z -8..12`, and
// the corner's `y` is not `0`. So the budget is the only thing left that can decide
// the placement.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNull } from "../assert";
import { CABLE_COST_PER_UNIT, LATTICE_PITCH, RING_COST } from "../constants";
import { clearAll, createHarness, openSite, type Harness } from "../harness";

/** Site 1's budget (specs/sites.md). */
const BUDGET = 3000;

/** One filler cable: the envelope's width, `x -8` to `x 12`. */
const CABLE_LENGTH = 20;
const CABLE_COST = CABLE_LENGTH * CABLE_COST_PER_UNIT;

/** Thirty-five of them: `2800`, leaving `200` of the budget unspent. */
const CABLES = 35;
const SPENT = CABLES * CABLE_COST;

/** The corner the ring would be seated by. */
const CORNER = { x: 4, y: 4, z: 4 };

/**
 * Spend `count` cables' worth of the budget, on distinct pairs of nodes.
 *
 * Each runs the full width of site 1's envelope at its own `(y, z)`, so no two
 * join the same two nodes and none reaches a node the ring occupies.
 */
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

it("refuses a ring the budget cannot pay for", async () => {
  await openSite(h, 0);
  await clearAll(h);
  const site = (await h.snapshot()).site;
  assertEqual(site.budget, BUDGET, "site 1's budget (specs/sites.md)");

  await spend(h, CABLES);
  const before = (await h.snapshot()).structure.cost;
  assertEqual(before, SPENT, "the cost this check spends up to");
  assertEqual(
    before + RING_COST > BUDGET,
    true,
    "a ring would carry the cost past the budget",
  );

  await h.debug.setRing(CORNER.x, CORNER.y, CORNER.z);

  await h.advance(1);
  await h.capture(
    "refused",
    "The crane after the unaffordable ring was refused",
  );

  assertNull(
    (await h.snapshot()).structure.ring,
    `the ring after a placement that would take the cost from ${SPENT} to ` +
      `${SPENT + RING_COST}, past the budget of ${BUDGET} ` +
      "(specs/structure.md)",
  );
});
