// editor/remove-counterweight — removeCounterweight takes a counterweight off its
// node and gives its cost back.
//
// specs/structure.md: "Removing a member, the ring, or a counterweight is always
// allowed", and the cost is a running sum of what the crane carries — "A crane's
// cost is the sum of its parts: each member's length times its material's cost per
// unit, plus `RING_COST` for the ring, plus `COUNTERWEIGHT_COST` per
// counterweight." So a counterweight taken off is a counterweight the sum no longer
// counts, and the `COUNTERWEIGHT_COST` (`40`) it cost goes back to the budget. A
// build that removed the block but kept charging for it would strand a player
// under a budget they had already freed.
//
// THE WORLD IS EMPTIED FIRST and exactly what the rule concerns is added back: one
// strut, so the structure uses a node at all — "placed on any node the structure
// uses, a node a member ends at or a flange node of the ring" — and one
// counterweight on that node's upper end. The strut runs from the anchor
// `(0, 0, 0)` to `(0, 4, 0)`, four units against `STRUT_MAX_LEN` (`6`), inside
// site 1's envelope and inside its budget, so nothing refuses either edit and the
// only thing the removal can change is the block and the `40` it cost.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { COUNTERWEIGHT_COST } from "../constants";
import { createHarness, emptyYard, openSite, type Harness } from "../harness";

/** The node the strut ends at, and the block hangs on. */
const NODE = { x: 0, y: 4, z: 0 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("takes a counterweight off its node and returns COUNTERWEIGHT_COST", async () => {
  await openSite(h, 0);
  await emptyYard(h);
  await h.debug.addMember(0, 0, 0, NODE.x, NODE.y, NODE.z, "strut");
  await h.debug.addCounterweight(NODE.x, NODE.y, NODE.z);

  const hung = (await h.snapshot()).structure;
  assertLength(
    hung.counterweights,
    1,
    "the counterweight this check then takes off (specs/structure.md)",
  );

  await h.debug.removeCounterweight(NODE.x, NODE.y, NODE.z);

  await h.advance(1);
  await h.capture("removed", "The node after its counterweight was taken off");

  const after = (await h.snapshot()).structure;
  assertLength(
    after.counterweights,
    0,
    "the counterweights standing after the removal (specs/structure.md)",
  );
  assertEqual(
    hung.cost - after.cost,
    COUNTERWEIGHT_COST,
    "what the removal gives back to the budget (specs/structure.md)",
  );
});
