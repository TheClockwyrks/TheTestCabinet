// editor/undo-restores-a-counterweight-placement — the undo after a counterweight
// placement takes the counterweight back off.
//
// `specs/structure.md` § The editor's rules puts every structure-changing edit
// under one undo: "undo restores the structure to what it was before the most
// recent structure-changing edit, as far back as the site was opened." A
// counterweight placement is such an edit — "placed on any node the structure
// uses ... it adds `COUNTERWEIGHT_MASS` at that node and costs
// `COUNTERWEIGHT_COST`" — so the undo after one leaves the node bare and returns
// the `COUNTERWEIGHT_COST` it spent, and touches nothing else that stands.
//
// The world is one strut and nothing else: the strut is what makes the node a
// node "the structure uses", so the counterweight can land at all, and it is also
// the reading that says the undo went back exactly one edit rather than further.
// A crane with more in it would say the same thing less clearly.

import { afterEach, beforeEach, it } from "vitest";
import { assertClose, assertLength } from "../assert";
import {
  BINDINGS,
  COUNTERWEIGHT_COST,
  STRUT_COST_PER_UNIT,
} from "../constants";
import { createHarness, emptyYard, openSite, type Harness } from "../harness";

/** The lone strut: a leg from the ground anchor up to the node under test. */
const FOOT = { x: 0, y: 0, z: 0 };
const HEAD = { x: 0, y: 4, z: 0 };

/** Its cost: `STRUT_COST_PER_UNIT` a unit over its four units of length. */
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

it("takes a placed counterweight back off and returns its cost", async () => {
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
    "the counterweight the node the strut ends at accepts (specs/structure.md)",
  );
  assertClose(
    hung.structure.cost,
    STRUT_COST + COUNTERWEIGHT_COST,
    COST_TOL,
    "the cost the counterweight added (specs/structure.md)",
  );

  await h.press(BINDINGS.undo[0]!);

  const s = await h.snapshot();
  await h.advance(1);
  await h.capture("undone", "The node bare again after the undo");

  assertLength(
    s.structure.counterweights,
    0,
    "the counterweights the undo took back off (specs/structure.md)",
  );
  assertLength(
    s.structure.members,
    1,
    "the strut the undo left standing: it reverses one edit, the placement",
  );
  assertClose(
    s.structure.cost,
    STRUT_COST,
    COST_TOL,
    "the cost the undo returned COUNTERWEIGHT_COST from (specs/structure.md)",
  );
});
