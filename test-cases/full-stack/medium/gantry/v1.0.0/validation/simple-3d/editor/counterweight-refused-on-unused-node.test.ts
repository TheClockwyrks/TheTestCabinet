// editor/counterweight-refused-on-unused-node — a counterweight on a node the
// structure does not use is refused.
//
// `specs/structure.md` § The editor's rules: "A counterweight placement is
// refused on a node the structure does not use, on a node already carrying one,
// or past the budget." § Counterweights says which nodes those are: "placed on
// any node the structure uses, a node a member ends at or a flange node of the
// ring". And "a refused edit changes nothing".
//
// The world is one strut, so the structure genuinely uses two nodes and the node
// under test is genuinely one it does not — a bare lattice would decide the same
// point only against a build that refuses everything, and this one decides it
// against a build that places a counterweight wherever it is clicked. The node
// chosen is well clear of the strut, on the lattice and inside site 1's envelope,
// so the only rule left standing between it and a counterweight is this one.

import { afterEach, beforeEach, it } from "vitest";
import { assertClose, assertLength } from "../assert";
import { STRUT_COST_PER_UNIT } from "../constants";
import { createHarness, emptyYard, openSite, type Harness } from "../harness";

/** The one strut: the two nodes the structure uses. */
const FOOT = { x: 0, y: 0, z: 0 };
const HEAD = { x: 0, y: 4, z: 0 };

/** A lattice node inside the envelope that no member ends at and no ring holds. */
const UNUSED = { x: 4, y: 4, z: 4 };

/** The strut's cost, which a refused edit leaves exactly where it stands. */
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

it("refuses a counterweight on a node no member ends at", async () => {
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
  const built = await h.snapshot();
  assertLength(
    built.structure.members,
    1,
    "the strut the structure is used by (specs/structure.md)",
  );

  await h.debug.addCounterweight(UNUSED.x, UNUSED.y, UNUSED.z);

  const s = await h.snapshot();
  await h.advance(1);
  await h.capture("refused", "The unused node, carrying no counterweight");

  assertLength(
    s.structure.counterweights,
    0,
    "the counterweights on a structure that uses no such node " +
      "(specs/structure.md)",
  );
  assertClose(
    s.structure.cost,
    STRUT_COST,
    COST_TOL,
    "the cost a refused edit leaves: it changes nothing " +
      "(specs/structure.md)",
  );
});
