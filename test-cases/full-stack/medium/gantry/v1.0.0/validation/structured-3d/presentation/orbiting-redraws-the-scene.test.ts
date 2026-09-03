// presentation/orbiting-redraws-the-scene — turning the camera redraws the yard
// from the new pose.
//
// specs/overview.md § Hard requirements: "Render a real 3D scene on the canvas:
// the yard, the lattice aids, the crane's members and parts, the loads, and the
// readouts, with a camera the player orbits." specs/controls.md § The camera: the
// build, program, and run screens "show the 3D yard through an orbit camera", and
// `setCamera` poses that camera's yaw, pitch, and distance.
//
// WHAT THAT MEANS FOR THE PICTURE, and it is the whole of what this point
// decides: a thing standing at a world position is drawn where the camera puts
// it, so moving the camera moves the drawing. A build that painted a fixed
// picture of a yard — a backdrop, a pre-rendered still — would answer the same
// place from every pose and fail here.
//
// WHAT IS READ, UNDER AN ENGINE. specs/instrumentation.md puts the camera on the
// engine under an engine build and says a caller "projects that world position
// through the engine's camera" — so where a fixed world position is drawn is
// `h.project`, and turning the camera has to move it. The frame after the pose is
// what draws it: a game poses `world.camera` from the orbit pose its state holds
// as part of running a frame, so a check that poses the camera and then asks
// where a point is drawn advances one first.
//
// TWO THINGS ARE READ, and both are needed. The point MOVES, which is a scene
// drawn through the camera rather than a still. And it moves the way the pose
// says: the yard is turned by a quarter turn about the slew axis, and a fixed
// world point on the far side of the target crosses the stage rather than
// creeping. A build that jittered its picture would pass the first and fail the
// second.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertTrue } from "../assert";
import {
  CAMERA_START_DIST,
  CAMERA_START_PITCH,
  CAMERA_START_YAW,
  CAMERA_TARGET,
  LATTICE_PITCH,
} from "../constants";
import {
  clearAll,
  createHarness,
  openSite,
  standMinimalCrane,
  type Harness,
  type Vec3,
} from "../harness";

const SITE = 0;

/** A world point on the crane, well off the slew axis the camera looks at. */
const MARK: Vec3 = { x: 8, y: 6, z: 0 };

/** How far round the yard is orbited: a quarter turn. */
const TURN = 90;

/**
 * How far the mark has to travel, in the stage's own units rather than in a
 * figure of this file's.
 *
 * The bar is the stage distance one `LATTICE_PITCH` spans at the camera's own
 * target, read through the build's projection: a scale the specification fixes,
 * measured by the build's own lens. A quarter turn carries a point eight units
 * off the slew axis right across the yard, so it travels many of those; a build
 * whose picture only jittered travels none.
 */

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws a fixed world point somewhere else once the camera is orbited", async () => {
  await openSite(h, SITE);
  await clearAll(h);
  await standMinimalCrane(h);
  await h.debug.setCamera(
    CAMERA_START_YAW,
    CAMERA_START_PITCH,
    CAMERA_START_DIST,
  );
  await h.advance(1);

  // One lattice pitch, as the stage distance the build itself draws it at.
  const origin = await h.project(
    CAMERA_TARGET.x,
    CAMERA_TARGET.y,
    CAMERA_TARGET.z,
  );
  const stepped = await h.project(
    CAMERA_TARGET.x + LATTICE_PITCH,
    CAMERA_TARGET.y,
    CAMERA_TARGET.z,
  );
  const pitchOnStage = Math.hypot(stepped.x - origin.x, stepped.y - origin.y);
  assertGreaterThan(
    pitchOnStage,
    0,
    "the stage distance one lattice pitch spans at the camera's target, " +
      "which is the scale this point measures the orbit against",
  );

  const before = await h.project(MARK.x, MARK.y, MARK.z);
  assertTrue(
    before.visible,
    `the world point (${MARK.x}, ${MARK.y}, ${MARK.z}) to be drawn on the ` +
      "stage at the start camera pose, so this point has a reading to take " +
      "(specs/instrumentation.md)",
  );

  await h.debug.setCamera(
    CAMERA_START_YAW + TURN,
    CAMERA_START_PITCH,
    CAMERA_START_DIST,
  );
  await h.advance(1);
  await h.capture("orbited", "The yard a quarter turn round");

  assertEqual(
    (await h.snapshot()).camera.yaw,
    CAMERA_START_YAW + TURN,
    "the camera yaw the orbit left, which this point reads the picture at " +
      "(specs/instrumentation.md)",
  );

  const after = await h.project(MARK.x, MARK.y, MARK.z);
  assertTrue(
    after.visible,
    `the same world point to be drawn on the stage ${TURN} degrees round, so ` +
      "the two readings are of one point drawn twice",
  );
  assertGreaterThan(
    Math.hypot(after.x - before.x, after.y - before.y),
    pitchOnStage,
    `how far the fixed world point (${MARK.x}, ${MARK.y}, ${MARK.z}) moved ` +
      `on the stage when the camera turned ${TURN} degrees, against the ` +
      `${pitchOnStage.toFixed(0)} logical pixels one lattice pitch spans ` +
      `there: the yard is "a ` +
      'real 3D scene ... with a camera the player orbits" ' +
      `(specs/overview.md). It was drawn at (${before.x.toFixed(0)}, ` +
      `${before.y.toFixed(0)}) and then at (${after.x.toFixed(0)}, ` +
      `${after.y.toFixed(0)})`,
  );
});
