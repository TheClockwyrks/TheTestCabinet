// assets/counterweight-model-at-its-node — a counterweight model stands on every
// node carrying one, and on no other.
//
// `specs/assets.md` § The models: "The game draws each model wherever its subject
// is: … a counterweight at each carrying node …". `specs/structure.md` fixes
// where one may go — "placed on any node the structure uses", one to a node — so
// the check places two on nodes a small structure uses and asks for both.
//
// BOTH DIRECTIONS. A build drawing one block for two counterweights satisfies
// neither node; a build drawing blocks on nodes that carry none draws them where
// no subject is.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertTrue } from "../assert";
import {
  clearAll,
  createHarness,
  entriesNear,
  entriesOf,
  openSite,
  type Harness,
} from "../harness";

/** Two nodes a one-member structure uses, and the block on each. */
const FOOT = { x: 0, y: 0, z: 0 };
const HEAD = { x: 0, y: 2, z: 0 };

/** How far a block may stand from the node it sits on. */
const REACH = 1.25;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws a counterweight model on each carrying node", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await h.debug.setScreen("build");
  await h.debug.setRing(4, 2, 0);
  await h.debug.addMember(
    FOOT.x,
    FOOT.y,
    FOOT.z,
    HEAD.x,
    HEAD.y,
    HEAD.z,
    "strut",
  );
  await h.debug.addCounterweight(FOOT.x, FOOT.y, FOOT.z);
  await h.debug.addCounterweight(HEAD.x, HEAD.y, HEAD.z);
  await h.advance(1);

  const drawn = await h.drawn();
  const blocks = entriesOf(drawn, "model", "counterweight");

  await h.capture("counterweights", "The counterweights on their nodes");

  assertEqual(
    blocks.length,
    2,
    "counterweight models drawn against the two placed",
  );
  for (const node of [FOOT, HEAD]) {
    assertTrue(
      entriesNear(drawn, node, REACH, "model", "counterweight").length > 0,
      `a counterweight drawn within ${REACH} units of the node at ` +
        `(${node.x}, ${node.y}, ${node.z})`,
    );
  }
});
