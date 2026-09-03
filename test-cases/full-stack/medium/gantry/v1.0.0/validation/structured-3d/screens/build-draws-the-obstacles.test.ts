// screens/build-draws-the-obstacles — the build screen draws an obstacle as the
// box it occupies.
//
// specs/ui.md § Build: "`build` shows the yard through the camera: the ground,
// the site's anchors and obstacles, the buildable lattice and envelope aids, the
// structure as built, and each load at its starting pose with its pad." An
// obstacle is a box — specs/world.md and the site tables give each one as a
// minimum corner and a size, and specs/structure.md refuses anything that reaches
// inside that box — so drawing an obstacle is drawing that box.
//
// THE READING IS A BEFORE AND AFTER, because what a build draws an obstacle as is
// entirely its own: a solid, a wireframe, a hatched slab. What is fixed is that
// adding one CHANGES the picture, and that the change lands where the box is. So
// the yard is emptied to nothing — no structure, no loads, no obstacles — what
// the frame draws is read, one obstacle is posed with nothing else touched, and
// it is read again.
//
// THE READING, UNDER AN ENGINE. There is no rasterizer in this project —
// `validation/host.ts` gives three a WebGL2 context that answers every call and
// draws nothing — so a claim about the yard is made against what the engine WOULD
// draw: `drawnObjects` answers every object the world pass will draw this frame,
// with the box its geometry fills, in world units. `engine/rendering.md` fixes
// that the pipeline collects every enabled, visible render component on every
// live actor and draws it, so any build of this case that draws an obstacle draws
// it there. Nothing is found by name: what the drawing is found by is the extent
// it fills.
//
// THE MARGIN IS AN HONEST TOLERANCE, not a fudge. A build draws a solid with an
// edge of some stroke width, may mark it as an obstacle rather than a plain
// block, and is free to bed it a hair proud of its own faces. A quarter of a unit
// is room for all of that and an eighth of `LATTICE_PITCH` (`2`), so a box drawn
// at the neighboring cell does not answer.
//
// AND NOTHING ELSE MAY HAVE ARRIVED WHERE THE OBSTACLE IS NOT: the yard away from
// the box has to draw what it drew, which is what tells a box drawn where the
// obstacle stands from a build that redraws the whole yard on every edit.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertTrue } from "../assert";
import {
  clearAll,
  createHarness,
  drawnObjects,
  drawnOver,
  drawnSignature,
  openSite,
  type Harness,
  type Vec3,
} from "../harness";

const SITE = 0;

/** The one obstacle: a tall slab, clear of the site's anchors. */
const MIN: Vec3 = { x: 4, y: 0, z: -2 };
const SIZE: Vec3 = { x: 2, y: 4, z: 4 };

/** A patch of yard the obstacle does not reach, which may not change. */
const ELSEWHERE: Vec3 = { x: -6, y: 1, z: 6 };

/** How far a face of the drawing may stand from the box's own. */
const SLACK = 0.25;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws a posed obstacle inside the box's extent", async () => {
  await openSite(h, SITE);
  await clearAll(h);
  await h.advance(1);

  const empty = await h.snapshot();
  assertEqual(empty.screen, "build", "the screen opening a site shows");
  assertEqual(
    empty.site.obstacles.length,
    0,
    "the obstacles standing in the emptied yard, before the one this point " +
      "poses",
  );
  const bare = drawnSignature(drawnOver(drawnObjects(h), ELSEWHERE));

  await h.debug.addObstacle(MIN.x, MIN.y, MIN.z, SIZE.x, SIZE.y, SIZE.z);
  await h.advance(1);
  await h.capture("obstacle-drawn", "The build screen with one obstacle");

  assertEqual(
    (await h.snapshot()).site.obstacles.length,
    1,
    "the obstacles standing in the yard once one is posed",
  );

  const max = { x: MIN.x + SIZE.x, y: MIN.y + SIZE.y, z: MIN.z + SIZE.z };
  const after = drawnObjects(h);
  const box = after.filter(
    (object) =>
      object.box !== null &&
      Math.abs(object.box.min.x - MIN.x) <= SLACK &&
      Math.abs(object.box.min.y - MIN.y) <= SLACK &&
      Math.abs(object.box.min.z - MIN.z) <= SLACK &&
      Math.abs(object.box.max.x - max.x) <= SLACK &&
      Math.abs(object.box.max.y - max.y) <= SLACK &&
      Math.abs(object.box.max.z - max.z) <= SLACK,
  );
  assertTrue(
    box.length > 0,
    `the build screen to draw the obstacle as the box (${MIN.x}, ${MIN.y}, ` +
      `${MIN.z}) + (${SIZE.x}, ${SIZE.y}, ${SIZE.z}), since it "shows the ` +
      "yard through the camera: the ground, the site's anchors and " +
      'obstacles" (specs/ui.md § Build) and an obstacle is the box its ' +
      "minimum corner and size give it (specs/world.md § Obstacles). What the " +
      "yard draws spans " +
      JSON.stringify(
        after
          .filter((object) => object.box !== null)
          .map((object) => [object.box!.min, object.box!.max]),
      ),
  );

  assertEqual(
    drawnSignature(drawnOver(after, ELSEWHERE)),
    bare,
    `the drawing over the patch of yard at (${ELSEWHERE.x}, ${ELSEWHERE.y}, ` +
      `${ELSEWHERE.z}), which the posed obstacle does not reach and which ` +
      "posing it may not change",
  );
});
