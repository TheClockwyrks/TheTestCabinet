// presentation/pad-on-an-obstacle-top — a pad whose target sits on an obstacle
// is drawn on that obstacle's top face.
//
// specs/world.md § Pads: "A load's target pose is drawn as its pad: a marked
// footprint on the ground OR ON AN OBSTACLE'S TOP, showing the class outline at
// the target yaw." specs/world.md § Obstacles says why such a target exists: "An
// obstacle's top face is therefore solid ground for a load: a pad may sit on top
// of an obstacle, and a load set down on that pad rests on the face without
// reaching inside the box, which is how a site asks for a lift onto a platform."
//
// THE SCENARIO IS SITE FIVE'S OWN LIFT. `High Shelf` carries the platform whose
// minimum corner is `(-9, 0, -2)` and whose size is `(4, 6, 4)`, and asks for its
// container on `(-7, 8, 0)` at yaw `90` (specs/sites.md). A container is
// `4 x 2 x 2` and a target pose is the pose of the lift point, the centre of the
// load's top face (specs/world.md), so a container resting on that pad stands on
// the platform's top face at `y = 6` — which is where its footprint belongs, six
// units above the ground the platform stands on.
//
// THE READING, UNDER AN ENGINE. There is no rasterizer in this project —
// `validation/host.ts` gives three a WebGL2 context that answers every call and
// draws nothing — so a claim about the yard is made against what the engine WOULD
// draw: `drawnObjects` answers every object the world pass will draw this frame,
// with the box its geometry fills and every one of its vertices, in world units.
// `engine/rendering.md` fixes that the pipeline collects every enabled, visible
// render component on every live actor and draws it, so any build of this case
// that puts something on screen puts it there. `drawnOver` narrows that to what
// stands over one place, and `drawnSignature` turns it into a value two frames
// can be compared by.
//
// NOTHING IS FOUND BY NAME, AND NO COLOUR IS ASSERTED. What a build calls an
// object, which component it reaches for and what it paints with are the
// build's; what a check holds it to is that the drawing over one place changed
// when the game did, and that the drawing elsewhere did not.
//
// WHERE THE FOOTPRINT IS, IS WHAT IS READ. The pad is moved away and back, and
// what arrives is measured in `y`: it has to stand at the platform's top face and
// not on the ground. A build that drew every pad on the ground draws this one six
// units under the load that is wanted on it.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear, assertTrue } from "../assert";
import {
  addOneLoad,
  clearAll,
  createHarness,
  drawnObjects,
  drawnOver,
  openSite,
  type DrawnObject,
  type Harness,
  type LoadPose,
} from "../harness";

/** Site 5, High Shelf. */
const SITE = 4;

/** The one load, and the platform's own lift (specs/sites.md). */
const CLASS = "container" as const;
const MASS = 80;
const START: LoadPose = { x: 8, y: 2, z: 0, yaw: 0 };
const TARGET: LoadPose = { x: -7, y: 8, z: 0, yaw: 90 };

/** The platform, and the height of its top face. */
const PLATFORM = { min: { x: -9, y: 0, z: -2 }, size: { x: 4, y: 6, z: 4 } };
const TOP_Y = PLATFORM.min.y + PLATFORM.size.y;

/** Where the pad waits while the bare platform top is read. */
const ELSEWHERE: LoadPose = { x: 6, y: 2, z: 6, yaw: 90 };

/** How far off the face the footprint may be bedded. */
const SLACK = 0.25;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** What the yard draws over the platform's top face, as a set of objects. */
function overTop(): DrawnObject[] {
  return drawnOver(
    drawnObjects(h),
    { x: TARGET.x, y: TOP_Y, z: TARGET.z },
    SLACK,
  );
}

it("marks the pad on the obstacle's top face at the target height", async () => {
  await openSite(h, SITE);
  await clearAll(h);
  await h.debug.addObstacle(
    PLATFORM.min.x,
    PLATFORM.min.y,
    PLATFORM.min.z,
    PLATFORM.size.x,
    PLATFORM.size.y,
    PLATFORM.size.z,
  );
  await addOneLoad(h, CLASS, MASS, START, ELSEWHERE);
  await h.advance(1);
  const bare = new Set(overTop().map((object) => JSON.stringify(object.box)));

  await h.debug.setLoadTarget(0, TARGET.x, TARGET.y, TARGET.z, TARGET.yaw);
  await h.advance(1);
  await h.capture("shelf-pad", "The pad on the platform's top face");

  assertEqual(
    JSON.stringify((await h.snapshot()).site.loads[0]?.to),
    JSON.stringify(TARGET),
    "the target the pose moved the pad to, which this point is about " +
      "(specs/instrumentation.md)",
  );

  const arrived = overTop().filter(
    (object) => !bare.has(JSON.stringify(object.box)),
  );
  assertTrue(
    arrived.length > 0,
    `something drawn on the platform's top face at (${TARGET.x}, ${TOP_Y}, ` +
      `${TARGET.z}) once the pad is asked for there, which is not drawn there ` +
      'when the pad is elsewhere: a pad is "a marked footprint on the ground ' +
      "or on an obstacle's top\" (specs/world.md)",
  );

  for (const object of arrived) {
    assertNear(
      object.box!.centre.y,
      TOP_Y,
      SLACK,
      `the height the footprint is drawn at, against the platform's top face ` +
        `(${TOP_Y}): the pad sits on the obstacle's top rather than on the ` +
        "ground under it (specs/world.md § Pads, § Obstacles)",
    );
  }
});
