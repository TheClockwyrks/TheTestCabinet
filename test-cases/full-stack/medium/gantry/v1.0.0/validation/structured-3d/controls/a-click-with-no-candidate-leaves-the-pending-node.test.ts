// controls/a-click-with-no-candidate-leaves-the-pending-node — a click on empty
// stage does nothing, and the pending node survives it.
//
// `specs/controls.md` § Clicks and drags: "A click with no candidate in range does
// nothing." § The build tools says what that has to leave behind: "Placing the
// member, a click on the pending node itself, `back` on the build screen, and
// opening a site are the whole of what clears it." A click into empty stage is
// none of those, so the node a player is halfway through joining is still held
// when they miss.
//
// THE PENDING NODE IS POSED RATHER THAN CLICKED. `setPendingNode` "holds that
// lattice node as the pending first node of a member placement, as a first click
// does" (`specs/instrumentation.md`), so the scenario is reached without a first
// click whose own picking could fail: a build with broken picking fails the
// picking points, and this one decides what a missed second click leaves. The
// node is `(0, 0, 0)`, an anchor of the open site and a lattice node inside its
// envelope.
//
// FINDING STAGE WITH NOTHING ON IT. A node pick "considers every lattice node in
// the envelope", a set the site fixes and no operation thins out, so the click
// has to be made somewhere none of them is drawn. Nothing in the specs fixes the
// field of view, so where that is is the build's own business: the check projects
// the envelope's eight corners, takes the box those projected points bound — every
// lattice node lies inside the envelope, so every one of them is drawn inside it —
// and clicks in the middle of the widest margin between that box and the edge of
// the stage. A point that far outside the box on one axis is at least that far
// from every node on it. The build's own `pick` is then read back at the point, so
// the click really is the one the specification describes.
//
// `clearAll` empties the structure too, so the click has no member candidate
// either and "no candidate in range" is the whole truth of it.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertLength, assertNull } from "../assert";
import { STAGE_H, STAGE_W } from "../constants";
import { clearAll, createHarness, openSite, type Harness } from "../harness";

/** The lattice node held pending: an anchor of the open site. */
const PENDING = { x: 0, y: 0, z: 0 } as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** A stage point outside everything the envelope can be drawn inside. */
async function emptyStagePoint(h: Harness): Promise<{ x: number; y: number }> {
  const { envelope } = (await h.snapshot()).site;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const x of [envelope.min.x, envelope.max.x]) {
    for (const y of [envelope.min.y, envelope.max.y]) {
      for (const z of [envelope.min.z, envelope.max.z]) {
        const at = await h.project(x, y, z);
        minX = Math.min(minX, at.x);
        maxX = Math.max(maxX, at.x);
        minY = Math.min(minY, at.y);
        maxY = Math.max(maxY, at.y);
      }
    }
  }
  const bands = [
    { gap: minX, point: { x: minX / 2, y: STAGE_H / 2 } },
    { gap: STAGE_W - maxX, point: { x: (maxX + STAGE_W) / 2, y: STAGE_H / 2 } },
    { gap: minY, point: { x: STAGE_W / 2, y: minY / 2 } },
    { gap: STAGE_H - maxY, point: { x: STAGE_W / 2, y: (maxY + STAGE_H) / 2 } },
  ];
  return bands.reduce((best, band) => (band.gap > best.gap ? band : best))
    .point;
}

it("holds the pending node and places nothing when a click takes nothing", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await h.debug.setTool("strut");
  await h.debug.setPendingNode(PENDING.x, PENDING.y, PENDING.z);

  const at = await emptyStagePoint(h);
  await h.pointerMove(at.x, at.y);
  await h.advance(1);
  const aimed = await h.snapshot();
  assertNull(
    aimed.pick.node,
    "the node candidate at the point the click is made, which the scenario " +
      "places clear of every lattice node drawn (specs/controls.md)",
  );
  assertNull(
    aimed.pick.member,
    "the member candidate at the point the click is made, with the structure " +
      "emptied (specs/controls.md)",
  );

  await h.click(at.x, at.y);

  const s = await h.snapshot();
  assertDeepEqual(
    s.pendingNode,
    PENDING,
    "the pending node after a click with no candidate in range, which does " +
      "nothing and so does not clear it (specs/controls.md)",
  );
  assertLength(
    s.structure.members,
    0,
    "the members standing after a click with no candidate in range, which " +
      "places nothing (specs/controls.md)",
  );

  await h.capture("state", "the build screen after a click onto empty stage");
});
