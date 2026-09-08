// presentation/picked-node-highlighted — the node a click would take is marked
// under the pointer.
//
// `specs/controls.md` fixes what a click takes on the build screen, and
// `specs/state.md` reports it as `pick.node`. `specs/ui.md` § Build asks that the
// player see it before committing to it, so what is picked is drawn.
//
// THE POINTER IS PUT ON A NODE THROUGH THE BUILD'S OWN PROJECTION. `project`
// answers "the point on the stage the world position is drawn at, through the
// camera as it stands" (`specs/instrumentation.md`), so the pointer goes where
// the build itself says the node is — never where a camera of this check's own
// would put it.

import { afterEach, beforeEach, it } from "vitest";
import { assertNotNull, assertTrue } from "../assert";
import {
  clearAll,
  createHarness,
  entriesOf,
  nodePoint,
  openSite,
  type Harness,
} from "../harness";

/** A lattice node inside the envelope, and where the pointer goes to pick it. */
const NODE = { x: 0, y: 0, z: 0 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("marks the node the pointer is picking", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await h.debug.setScreen("build");

  const at = await nodePoint(h, NODE);
  assertTrue(
    at.visible,
    "the node to be drawn on the stage, so it can be picked",
  );
  await h.pointerMove(at.x, at.y);
  await h.advance(1);

  const { pick } = await h.snapshot();
  const drawn = await h.drawn();

  await h.capture("pick", "The picked node, marked under the pointer");

  assertNotNull(
    pick.node,
    "a node picked under the pointer (specs/controls.md)",
  );
  assertTrue(
    entriesOf(drawn, "mark", "picked-node").length > 0,
    "a picked-node mark among what the frame drew (specs/ui.md)",
  );
});
