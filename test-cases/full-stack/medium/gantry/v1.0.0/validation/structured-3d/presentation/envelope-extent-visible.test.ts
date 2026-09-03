// presentation/envelope-extent-visible — the build screen draws the envelope's
// extent as a visible aid, at the site's own ranges.
//
// specs/overview.md § Visual design, the row for the lattice: "On the build
// screen, the buildable lattice and THE ENVELOPE'S EXTENT are visible aids, and
// the picked node under the pointer is highlighted." specs/world.md makes the
// envelope the site's own: each site fixes the inclusive range the crane may be
// built inside on each axis, and specs/structure.md refuses a member with an end
// outside it. A player who cannot see where that boundary runs cannot tell a
// placement that will be accepted from one that will not.
//
// TWO SITES WITH DIFFERENT ENVELOPES, because the requirement is not that SOME
// boundary is drawn but that the one drawn is the OPEN SITE's: a build that drew
// a fixed box round the yard would answer the same extent on both and fail here.
//
// THE READING, UNDER AN ENGINE. There is no rasterizer in this project —
// `validation/host.ts` gives three a WebGL2 context that answers every call and
// draws nothing — so a claim about the yard is made against what the engine WOULD
// draw: `drawnObjects` answers every object the world pass will draw this frame,
// with the box its geometry fills, in world units. `engine/rendering.md` fixes
// that the pipeline collects every enabled, visible render component on every
// live actor and draws it, so any build of this case that draws an aid draws it
// there. Nothing is found by name: what the aid is found by is the extent it
// fills.
//
// WHAT COUNTS AS THE AID IS SOMETHING DRAWN AT THE SITE'S OWN EXTENT — an object
// whose box is the envelope's own, on every one of its six faces. A wire box, a
// frame of edges, a floor grid raised to the envelope's height and a cloud of
// nodes filling it all answer that; a fixed box round the yard does not, because
// it does not move when the site does.
//
// AND IT IS READ ON AN EMPTIED YARD with the pointer parked off every node, so
// nothing found is a member, a load, or a highlight.
//
// THE TOLERANCE IS A QUARTER OF A UNIT on each face, which is an eighth of
// `LATTICE_PITCH` (`2`): room for an aid drawn a hair proud of the boundary so it
// does not fight the outermost lattice nodes for the same pixels, and far short
// of the next node out.

import { afterEach, beforeEach, it } from "vitest";
import { assertNull, assertTrue } from "../assert";
import { SITES, STAGE_H, STAGE_W } from "../constants";
import {
  clearAll,
  createHarness,
  drawnObjects,
  openSite,
  type Harness,
} from "../harness";

/**
 * Two sites whose envelopes differ, chosen off `specs/sites.md`'s own figures
 * rather than named: the first site, and the first one after it that spans a
 * different box.
 */
const NEAR_SITE = 0;
const FAR_SITE = SITES.findIndex(
  (site, index) =>
    index !== NEAR_SITE &&
    JSON.stringify(site.envelope) !==
      JSON.stringify(SITES[NEAR_SITE]!.envelope),
);

/** Where the pointer is parked: a stage corner, over no node. */
const PARKED = { x: STAGE_W - 4, y: STAGE_H - 4 } as const;

/** How far a face of the aid may stand from the envelope's own. */
const SLACK = 0.25;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** Whether anything drawn fills the box `min`..`max`, within `SLACK`. */
function drawnAtExtent(
  min: {
    x: number;
    y: number;
    z: number;
  },
  max: { x: number; y: number; z: number },
): boolean {
  return drawnObjects(h).some((object) => {
    const box = object.box;
    return (
      box !== null &&
      Math.abs(box.min.x - min.x) <= SLACK &&
      Math.abs(box.min.y - min.y) <= SLACK &&
      Math.abs(box.min.z - min.z) <= SLACK &&
      Math.abs(box.max.x - max.x) <= SLACK &&
      Math.abs(box.max.y - max.y) <= SLACK &&
      Math.abs(box.max.z - max.z) <= SLACK
    );
  });
}

/** Open `site`, empty its yard, and settle a frame. */
async function show(site: number): Promise<void> {
  await openSite(h, site);
  await clearAll(h);
  await h.pointerMove(PARKED.x, PARKED.y);
  await h.advance(1);
  assertNull(
    (await h.snapshot()).pick.node,
    "no node picked under the parked pointer, so nothing read here is a " +
      "highlight (specs/controls.md)",
  );
}

it("draws the envelope's boundary where the open site's ranges put it", async () => {
  assertTrue(
    FAR_SITE > 0,
    "two of the sites to span different envelopes, which is what says the " +
      "aid follows the open site rather than the yard (specs/sites.md)",
  );

  const near = SITES[NEAR_SITE]!.envelope;
  const far = SITES[FAR_SITE]!.envelope;
  const corners = (envelope: typeof near) => ({
    min: { x: envelope.x.min, y: envelope.y.min, z: envelope.z.min },
    max: { x: envelope.x.max, y: envelope.y.max, z: envelope.z.max },
  });

  await show(NEAR_SITE);
  await h.capture("envelope", "The envelope aid on the open site");
  const nearBox = corners(near);
  const farBox = corners(far);

  assertTrue(
    drawnAtExtent(nearBox.min, nearBox.max),
    `something drawn filling the open site's own envelope, x ` +
      `${near.x.min} to ${near.x.max}, y ${near.y.min} to ${near.y.max}, z ` +
      `${near.z.min} to ${near.z.max}: "the buildable lattice and the ` +
      "envelope's extent are visible aids\" on the build screen " +
      "(specs/overview.md). What the yard draws spans " +
      JSON.stringify(
        drawnObjects(h)
          .filter((object) => object.box !== null)
          .map((object) => [object.box!.min, object.box!.max]),
      ),
  );
  assertTrue(
    !drawnAtExtent(farBox.min, farBox.max),
    `nothing drawn at the OTHER site's envelope while this one is open, x ` +
      `${far.x.min} to ${far.x.max}, y ${far.y.min} to ${far.y.max}, z ` +
      `${far.z.min} to ${far.z.max}: the aid is drawn at the open site's own ` +
      "ranges (specs/world.md, specs/overview.md)",
  );

  await show(FAR_SITE);

  assertTrue(
    drawnAtExtent(farBox.min, farBox.max),
    `something drawn filling the envelope of the site now open, x ` +
      `${far.x.min} to ${far.x.max}, y ${far.y.min} to ${far.y.max}, z ` +
      `${far.z.min} to ${far.z.max} (specs/overview.md)`,
  );
  assertTrue(
    !drawnAtExtent(nearBox.min, nearBox.max),
    `nothing still drawn at the first site's envelope once another is open, ` +
      `x ${near.x.min} to ${near.x.max}, y ${near.y.min} to ${near.y.max}, z ` +
      `${near.z.min} to ${near.z.max}: the aid follows the site's ranges ` +
      "(specs/world.md)",
  );
});
