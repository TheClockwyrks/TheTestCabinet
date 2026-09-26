// editor/pending-node-cleared-by-opening-a-site — opening a site drops a pending
// node.
//
// `specs/controls.md` § The build tools closes the list: "Placing the member, a
// click on the pending node itself, `back` on the build screen, and opening a
// site are the whole of what clears it." `specs/state.md` § What a site opening
// does states the same effect from the state's side — opening a site "empties the
// undo history, clears the pending node and the shown check result" — and
// `specs/instrumentation.md` says `openSite` "carries the effects `specs/state.md`
// states for opening a site".
//
// THE SITE OPENED IS A DIFFERENT ONE, site 1, so the clear cannot be confused
// with a build that merely reloads what it stored for the site it is already on.
// `openSite` reaches a site "locked or not", so nothing has to be cleared to get
// there.
//
// THE HELD NODE IS THE PRECONDITION, so it is read back before the site is
// opened: without that reading a build that never held the node at all would show
// `null` afterwards and pass.
//
// The yard is emptied first so nothing else is in flight — the structure and the
// tape are already the empty ones the harness's opening reset left — and
// `(0, 0, 0)` is a ground anchor of site 0, inside its envelope.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull, assertNull } from "../assert";
import {
  createHarness,
  emptyYard,
  openSite,
  type Harness,
  type Vec3,
} from "../harness";

/** The node held pending on the first site: one of its ground anchors. */
const NODE: Vec3 = { x: 0, y: 0, z: 0 };

/** The site opened next, so the clear is not a reload of the same site. */
const NEXT_SITE = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("drops the pending node when a site is opened", async () => {
  await openSite(h, 0);
  await emptyYard(h);

  await h.debug.setPendingNode(NODE.x, NODE.y, NODE.z);
  const posed = await h.snapshot();
  assertNotNull(
    posed.pendingNode,
    `the pending node at (${NODE.x}, ${NODE.y}, ${NODE.z}), held when the ` +
      "next site is opened",
  );

  await openSite(h, NEXT_SITE);
  await h.advance(1);

  const s = await h.snapshot();
  await h.capture(
    "pending-node-cleared-by-opening-a-site",
    "The newly opened site, with no node held pending",
  );

  assertEqual(s.siteIndex, NEXT_SITE, "the site that was opened");
  assertNull(
    s.pendingNode,
    "the pending node an opening clears (specs/controls.md, specs/state.md)",
  );
});
