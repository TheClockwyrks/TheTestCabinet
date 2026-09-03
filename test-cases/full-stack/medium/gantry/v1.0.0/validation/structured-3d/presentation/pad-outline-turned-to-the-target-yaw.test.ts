// presentation/pad-outline-turned-to-the-target-yaw — a pad's outline is turned
// to the target yaw.
//
// specs/world.md § Pads: "A load's target pose is drawn as its pad: a marked
// footprint on the ground or on an obstacle's top, showing the class outline at
// the target yaw." specs/overview.md § Visual design asks for the same thing from
// the player's side: "each pad's footprint and required yaw are marked so a site
// is readable before anything is built".
//
// THE LOAD IS A CONTAINER, because its class box is `4 x 2 x 2`
// (specs/world.md § Loads) and so its footprint is a RECTANGLE rather than a
// square: four units along `x` and two along `z` at yaw `0`, and the other way
// round at yaw `90`, since "a positive yaw turns `+x` toward `+z`"
// (specs/world.md § The world frame). A crate's square footprint would look the
// same at both yaws and could decide nothing.
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
// WHAT IS MEASURED IS THE FOOTPRINT'S OWN EXTENT. The pad is put at the target
// twice, once at each yaw, and what arrives on the ground each time is read: the
// object that stands over the target and did not stand there before the pad
// arrived. Its extent along `x` and along `z` must SWAP between the two yaws,
// which is what "the class outline at the target yaw" means for a rectangle and
// what a build drawing an untutned outline cannot do.
//
// THE TOLERANCE IS A QUARTER OF A UNIT, room for an outline drawn a hair proud of
// the class box, and far short of the two units that separate the two extents.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear, assertTrue } from "../assert";
import { LOAD_CLASS_DIMENSIONS } from "../constants";
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

const SITE = 0;

/** The one load: a container, whose footprint is a rectangle. */
const CLASS = "container" as const;
const MASS = 90;
const START: LoadPose = { x: 10, y: 2, z: 0, yaw: 0 };

/** Where the pad goes, and where it waits while the bare ground is read. */
const TARGET = { x: 0, y: 2, z: 8 } as const;
const ELSEWHERE: LoadPose = { x: -10, y: 2, z: -6, yaw: 0 };

/**
 * How far the footprint's own extent may stand from the class outline's, and how
 * far off the ground it may be bedded.
 */
const SLACK = 0.25;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** What the yard draws on the ground over the target, as a set of objects. */
function overTarget(): DrawnObject[] {
  return drawnOver(drawnObjects(h), { x: TARGET.x, y: 0, z: TARGET.z }, SLACK);
}

/** The footprint the pad puts there at `yaw`: what arrives that was not there. */
async function footprintAt(yaw: number): Promise<DrawnObject> {
  await h.debug.setLoadTarget(
    0,
    ELSEWHERE.x,
    ELSEWHERE.y,
    ELSEWHERE.z,
    ELSEWHERE.yaw,
  );
  await h.advance(1);
  const bare = new Set(
    overTarget().map((object) => JSON.stringify(object.box)),
  );

  await h.debug.setLoadTarget(0, TARGET.x, TARGET.y, TARGET.z, yaw);
  await h.advance(1);
  const arrived = overTarget().filter(
    (object) => !bare.has(JSON.stringify(object.box)),
  );
  assertTrue(
    arrived.length > 0,
    `something drawn on the ground at the pad's target (${TARGET.x}, ` +
      `${TARGET.z}) at yaw ${yaw} that is not there when the pad is ` +
      "elsewhere: \"A load's target pose is drawn as its pad: a marked " +
      'footprint on the ground" (specs/world.md)',
  );
  // The largest of them: an outline and its yaw mark may both arrive, and the
  // outline is the one that carries the class box's own extent.
  return arrived.reduce((one, other) =>
    (other.box?.size.x ?? 0) * (other.box?.size.z ?? 0) >
    (one.box?.size.x ?? 0) * (one.box?.size.z ?? 0)
      ? other
      : one,
  );
}

it("turns the pad's outline to the target yaw", async () => {
  await openSite(h, SITE);
  await clearAll(h);
  await addOneLoad(h, CLASS, MASS, START, ELSEWHERE);
  await h.advance(1);

  const size = LOAD_CLASS_DIMENSIONS[CLASS];
  const square = await footprintAt(0);
  const turned = await footprintAt(90);
  await h.capture("pad-yaw", "The pad's outline at yaw 0 and at yaw 90");

  assertEqual(
    (await h.snapshot()).site.loads[0]?.to.yaw,
    90,
    "the target yaw the pose left the pad at, which this point is about " +
      "(specs/instrumentation.md)",
  );

  assertNear(
    square.box!.size.x,
    size.x,
    SLACK,
    `the footprint's extent along x at target yaw 0, against the container's ` +
      `own class width (${size.x}): the pad shows "the class outline at the ` +
      'target yaw" (specs/world.md)',
  );
  assertNear(
    square.box!.size.z,
    size.z,
    SLACK,
    `the footprint's extent along z at target yaw 0, against the container's ` +
      `own class depth (${size.z}) (specs/world.md)`,
  );
  assertNear(
    turned.box!.size.x,
    size.z,
    SLACK,
    `the footprint's extent along x at target yaw 90, which a positive yaw ` +
      `turns from +x toward +z, so the class depth (${size.z}) is what lies ` +
      "along x (specs/world.md § Pads, § The world frame)",
  );
  assertNear(
    turned.box!.size.z,
    size.x,
    SLACK,
    `the footprint's extent along z at target yaw 90, which is the class ` +
      `width (${size.x}) turned onto that axis (specs/world.md)`,
  );
});
