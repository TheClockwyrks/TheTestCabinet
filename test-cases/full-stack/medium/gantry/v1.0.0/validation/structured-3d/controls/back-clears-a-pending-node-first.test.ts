// controls/back-clears-a-pending-node-first — with a node held pending, `back`
// clears it and stays on the build screen.
//
// `specs/controls.md` § The actions: "`back` resolves against the first of these
// that applies", and the first row is "The build screen, with a pending node held
// — Clears the pending node and stays on the build screen". The screen half of
// the assertion is what makes it the FIRST row rather than the last: the last row
// would leave `build` for `select` (`specs/ui.md`), so a build that resolved
// `back` in the wrong order fails here. § The build tools states the same rule
// from the placement's side: "A second click on the pending node itself, or
// `back`, clears it without placing", and "Placing the member, a click on the
// pending node itself, `back` on the build screen, and opening a site are the
// whole of what clears it".
//
// THE PENDING NODE IS POSED RATHER THAN CLICKED. `setPendingNode` "holds that
// lattice node as the pending first node of a member placement, as a first click
// does" (`specs/instrumentation.md`), so the scenario is reached without pressing
// anything the pick rules own: a build whose picking is broken fails the picking
// items and this one decides `back` alone.
//
// The node is `(0, 0, 0)`: a lattice node on the pitch, an anchor of the open
// site, and inside site 1's envelope (`specs/sites.md`), so nothing about the
// node itself can refuse the pose. The structure and the yard are emptied first,
// so nothing else stands that `back` could be resolving against.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull, assertNull } from "../assert";
import { BINDINGS } from "../constants";
import { clearAll, createHarness, openSite, type Harness } from "../harness";

/** `back`'s binding, as `specs/controls.md` fixes it. */
const BACK = BINDINGS.back[0]!;

/** The lattice node held pending: an anchor of the open site. */
const NODE = { x: 0, y: 0, z: 0 } as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("clears the pending node and stays on the build screen", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await h.debug.setPendingNode(NODE.x, NODE.y, NODE.z);
  const posed = await h.snapshot();
  assertEqual(posed.screen, "build", "the screen `back` is pressed on");
  assertNotNull(
    posed.pendingNode,
    "the pending first node setPendingNode holds (specs/instrumentation.md)",
  );

  await h.press(BACK);
  const s = await h.snapshot();
  assertNull(
    s.pendingNode,
    "the pending node after `back` on the build screen, which clears it " +
      "without placing (specs/controls.md)",
  );
  assertEqual(
    s.screen,
    "build",
    "the screen after that `back`, which resolves against the pending node " +
      "before the screen it would otherwise leave (specs/controls.md)",
  );

  await h.advance(1);
  await h.capture("state", "the build screen with the pending node cleared");
});
