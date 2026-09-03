// presentation/obstacles-drawn — the build screen draws each obstacle as the box
// it occupies.
//
// specs/ui.md § Build: "`build` shows the yard through the camera: the ground,
// the site's anchors and obstacles, the buildable lattice and envelope aids, the
// structure as built, and each load at its starting pose with its pad."
// specs/world.md § Obstacles gives an obstacle its shape: it is the axis-aligned
// box its minimum corner and its size describe.
//
// SO WHAT IS DECIDED IS THAT POSING ONE PUTS THAT BOX IN THE PICTURE. A build that
// drew no obstacle would hide from a player the one thing in the yard that can
// end a run by being struck; a build that drew it as a marker somewhere near it
// would misstate what the run collides with.
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
// THE READING IS A BEFORE AND AFTER, so that what is found is the obstacle's own
// drawing rather than something the yard already carried: the yard is emptied,
// the objects the frame draws are read, one obstacle is posed, and the objects
// are read again. Something new has to stand where the box is.
//
// AND ITS EXTENT HAS TO BE THE BOX'S. A quarter of a unit either way is room for
// an outline drawn a hair proud of the faces, and far short of the two units that
// would make it the neighboring cell.

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

/** The one obstacle: a tall box, clear of the site's anchors. */
const MIN = { x: 4, y: 0, z: 4 } as const;
const SIZE = { x: 4, y: 6, z: 4 } as const;

/** How far a face of the drawing may stand from the box's own. */
const SLACK = 0.25;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws a posed obstacle as the box its corner and size give it", async () => {
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
  const before = drawnObjects(h).length;

  await h.debug.addObstacle(MIN.x, MIN.y, MIN.z, SIZE.x, SIZE.y, SIZE.z);
  await h.advance(1);
  await h.capture("obstacle", "The yard with one obstacle standing in it");

  assertEqual(
    (await h.snapshot()).site.obstacles.length,
    1,
    "the obstacles standing in the yard once one is posed",
  );

  const max = { x: MIN.x + SIZE.x, y: MIN.y + SIZE.y, z: MIN.z + SIZE.z };
  const after = drawnObjects(h);
  assertTrue(
    after.length > before,
    `something new drawn once an obstacle is posed: the build screen shows ` +
      `"the site's anchors and obstacles" (specs/ui.md § Build) — the yard ` +
      `drew ${before} objects before and ${after.length} after`,
  );

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
    `something drawn filling the box (${MIN.x}, ${MIN.y}, ${MIN.z}) + ` +
      `(${SIZE.x}, ${SIZE.y}, ${SIZE.z}), which is the obstacle the pose ` +
      "stood in the yard (specs/world.md § Obstacles, specs/ui.md § Build). " +
      "What the yard draws is " +
      JSON.stringify(
        after
          .filter((object) => object.box !== null)
          .map((object) => [object.box!.min, object.box!.max]),
      ),
  );
});
