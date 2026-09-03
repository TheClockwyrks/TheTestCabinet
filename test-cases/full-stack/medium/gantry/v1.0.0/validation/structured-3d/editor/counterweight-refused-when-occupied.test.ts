// editor/counterweight-refused-when-occupied — a second counterweight on a node
// already carrying one is refused.
//
// `specs/structure.md` § Counterweights: "A node carries at most one
// counterweight." § The editor's rules carries it into the editor: "A
// counterweight placement is refused ... on a node already carrying one", and "a
// refused edit changes nothing", so the second placement leaves one block on the
// node and spends no second `COUNTERWEIGHT_COST`.
//
// The world is one strut and one node, and the same call is made twice against
// it: everything but the node's occupancy is identical between the accepted
// placement and the refused one, so the occupancy is the only thing the second
// call can have been refused for.

import { afterEach, beforeEach, it } from "vitest";
import { assertClose, assertEqual, assertLength } from "../assert";
import { COUNTERWEIGHT_COST, STRUT_COST_PER_UNIT } from "../constants";
import { createHarness, emptyYard, openSite, type Harness } from "../harness";

/** The one strut, and the node at its head that carries the block. */
const FOOT = { x: 0, y: 0, z: 0 };
const HEAD = { x: 0, y: 4, z: 0 };

/** The strut's cost, which both placements are measured on top of. */
const STRUT_COST = STRUT_COST_PER_UNIT * 4;

/** Costs are sums of exact figures, so this is float slop and nothing more. */
const COST_TOL = 1e-6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves one counterweight on a node a second was placed on", async () => {
  await openSite(h, 0);
  await emptyYard(h);

  await h.debug.addMember(
    FOOT.x,
    FOOT.y,
    FOOT.z,
    HEAD.x,
    HEAD.y,
    HEAD.z,
    "strut",
  );
  await h.debug.addCounterweight(HEAD.x, HEAD.y, HEAD.z);

  const hung = await h.snapshot();
  assertLength(
    hung.structure.counterweights,
    1,
    "the counterweight the used node accepts (specs/structure.md)",
  );

  await h.debug.addCounterweight(HEAD.x, HEAD.y, HEAD.z);

  const s = await h.snapshot();
  await h.advance(1);
  await h.capture("refused", "The node still carrying exactly one block");

  assertLength(
    s.structure.counterweights,
    1,
    "the counterweights on the node: at most one (specs/structure.md)",
  );
  assertEqual(
    JSON.stringify(s.structure.counterweights[0]),
    JSON.stringify({ x: HEAD.x, y: HEAD.y, z: HEAD.z }),
    "the node the one counterweight stands on",
  );
  assertClose(
    s.structure.cost,
    STRUT_COST + COUNTERWEIGHT_COST,
    COST_TOL,
    "the cost, which rose by COUNTERWEIGHT_COST once and not twice " +
      "(specs/structure.md)",
  );
});
