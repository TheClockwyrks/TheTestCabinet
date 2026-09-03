// presentation/ground-drawn — the plane y = 0 is drawn as the yard floor.
//
// specs/world.md § The world frame: "The world is measured in units on a
// right-handed frame: `x` and `z` are horizontal, `y` is up, and THE GROUND IS
// THE PLANE `y = 0`." specs/ui.md § Build has the build screen show "the yard
// through the camera: the ground, the site's anchors and obstacles …", and
// specs/overview.md leaves the ground's look to the build — "The yard is yours to
// art-direct: the palette, the sky, the ground, the light".
//
// SO WHAT IS DECIDED IS THAT THERE IS A FLOOR, AND THAT IT IS THAT PLANE. A build
// that drew no ground at all, or drew one somewhere other than `y = 0`, would
// leave a player with nothing to read a yard against; what it looks like is not
// this point's business.
//
// THE READING, UNDER AN ENGINE. There is no rasterizer in this project —
// `validation/host.ts` gives three a WebGL2 context that answers every call and
// draws nothing — so a claim about the yard is made against what the engine WOULD
// draw: `drawnObjects` answers every object the world pass will draw this frame,
// with the box its geometry fills and every one of its vertices, in world units.
// `engine/rendering.md` fixes that the pipeline collects every enabled, visible
// render component on every live actor and draws it, so any build of this case
// that puts something on screen puts it there.
//
// NOTHING IS FOUND BY NAME. What a build calls an object, which component it
// reaches for, and what colour it paints with are all the build's; what a check
// finds an object by is WHERE IT IS and WHAT SHAPE IT HAS.
//
// THE FLOOR IS THE OBJECT THAT LIES IN THE PLANE AND REACHES ACROSS THE YARD.
// Being IN the plane is what makes it the ground rather than a slab a build put
// somewhere; reaching across the yard is what makes it a floor rather than a
// marker. So the reading is one drawn object, flat in `y` about `0`, whose extent
// in `x` and `z` covers the whole of the open site's envelope footprint — which
// is the part of the world a player builds in and therefore the least a floor
// under it can be.
//
// THE TOLERANCE IN `y` IS A TENTH OF A UNIT, which is room for a build that beds
// its floor a hair under the plane so the aids drawn on it are not fighting it
// for the same pixels, and far short of `LATTICE_PITCH` (`2`).

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertTrue } from "../assert";
import {
  clearAll,
  createHarness,
  drawnObjects,
  openSite,
  type Harness,
} from "../harness";

const SITE = 0;

/** How far off the plane `y = 0` a floor may be bedded. */
const FLAT = 0.1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws the plane y = 0 as a floor under the yard", async () => {
  await openSite(h, SITE);
  await clearAll(h);
  await h.advance(1);

  const posed = await h.snapshot();
  assertEqual(posed.screen, "build", "the screen opening a site shows");
  const envelope = posed.site.envelope;

  await h.capture("floor", "The empty yard, floor against sky");

  const floors = drawnObjects(h).filter(
    (object) =>
      object.box !== null &&
      // Flat in the plane the ground IS.
      Math.abs(object.box.min.y) <= FLAT &&
      Math.abs(object.box.max.y) <= FLAT &&
      // And reaching across the whole of what a player builds in.
      object.box.min.x <= envelope.min.x &&
      object.box.max.x >= envelope.max.x &&
      object.box.min.z <= envelope.min.z &&
      object.box.max.z >= envelope.max.z,
  );

  assertTrue(
    floors.length > 0,
    "something drawn flat in the plane y = 0 and reaching across the open " +
      `site's envelope footprint, x ${envelope.min.x} to ${envelope.max.x} ` +
      `and z ${envelope.min.z} to ${envelope.max.z}: the ground is that plane ` +
      "(specs/world.md § The world frame) and the build screen shows it " +
      "(specs/ui.md § Build). What the yard draws is " +
      JSON.stringify(
        drawnObjects(h)
          .filter((object) => object.box !== null)
          .map((object) => ({
            type: object.type,
            y: [object.box!.min.y, object.box!.max.y],
            x: [object.box!.min.x, object.box!.max.x],
            z: [object.box!.min.z, object.box!.max.z],
          })),
      ),
  );
});
