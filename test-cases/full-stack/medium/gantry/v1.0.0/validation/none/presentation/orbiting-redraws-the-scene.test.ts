// presentation/orbiting-redraws-the-scene — orbiting the camera moves where the
// world is drawn.
//
// `specs/controls.md` gives the player an orbit camera, and `specs/ui.md` has the
// build screen show "the yard THROUGH THE CAMERA". A yard drawn the same way
// whatever the camera is doing is not being seen through it.
//
// THE READING IS THE BUILD'S OWN PROJECTION. `project` answers "the point on the
// stage the world position `(x, y, z)` is drawn at, THROUGH THE CAMERA AS IT
// STANDS" (`specs/instrumentation.md`), so this asks the build where one fixed
// world point is drawn, orbits, and asks again. Nothing about the picture is
// read: what moved is the build's own answer.
//
// THE POINT IS FIXED AND THE CAMERA IS NOT, which is what makes the reading about
// the camera. `setCamera` "sets the orbit camera's pose as the orbit controls set
// it", holding the pitch and distance inside their limits, so both poses are ones
// a player can reach.

import { afterEach, beforeEach, it } from "vitest";
import { assertTrue } from "../assert";
import { clearAll, createHarness, openSite, type Harness } from "../harness";

/** A world point in the yard, fixed while the camera moves. */
const POINT = { x: 2, y: 2, z: 2 };

/** Two camera poses a player can reach, a quarter turn apart. */
const FROM = { yaw: 0, pitch: 30, dist: 24 };
const TO = { yaw: 90, pitch: 30, dist: 24 };

/** How far the drawn point must move, in logical stage units. */
const MOVED = 20;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws the yard through the camera, so orbiting moves it", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await h.debug.setScreen("build");

  await h.debug.setCamera(FROM.yaw, FROM.pitch, FROM.dist);
  await h.advance(1);
  const before = await h.project(POINT.x, POINT.y, POINT.z);

  await h.debug.setCamera(TO.yaw, TO.pitch, TO.dist);
  await h.advance(1);
  const after = await h.project(POINT.x, POINT.y, POINT.z);

  await h.capture("orbited", "The yard after the camera has orbited");

  assertTrue(
    before.visible && after.visible,
    "the point to be drawn on the stage at both camera poses, so the two " +
      "readings can be compared",
  );
  const moved = Math.hypot(after.x - before.x, after.y - before.y);
  assertTrue(
    moved >= MOVED,
    `a fixed world point to be drawn somewhere else once the camera orbits a ` +
      `quarter turn — it moved ${moved.toFixed(1)} stage units (specs/ui.md)`,
  );
});
