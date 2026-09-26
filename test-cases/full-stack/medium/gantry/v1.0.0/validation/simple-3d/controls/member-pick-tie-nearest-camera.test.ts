// controls/member-pick-tie-nearest-camera — two members tied under the pointer,
// and the candidate is the one whose nearest point stands nearest the camera.
//
// `specs/controls.md` § Clicks and drags: "A member pick considers every
// member's projected segment; the candidate is the nearest at most
// `MEMBER_PICK_PX` (`12`) logical pixels from the click, ties going to the
// member whose nearest point on that segment is nearest the camera, and then to
// the lower member id."
//
// THE TIE IS MADE BY THE CAMERA'S OWN PLANE OF SYMMETRY. At yaw `45` the camera
// stands on the plane `x = z` and looks along it (`specs/controls.md` fixes the
// eye as `CAMERA_TARGET` plus `dist * (cos(pitch) cos(yaw), sin(pitch),
// cos(pitch) sin(yaw))`, and `CAMERA_TARGET` is `(0, 6, 0)`), so every world
// position with `x = z` is drawn on one vertical line of the stage — whatever
// lens the build draws through. Two members that both lie in that plane
// therefore project onto that same line, one above the other in depth, and a
// click on the stretch they share is zero pixels from BOTH.
//
// So the screen distances tie and the camera distance decides. The member placed
// SECOND is the near one, so it carries the HIGHER id: a build that broke the tie
// by id, skipping the camera rule, would answer `0`, and a build that never
// reaches the tie at all answers the member the click is exactly on, which is
// also `0`. Only the stated rule answers `1`.
//
// The click is the point the build says it drew the FAR member's lower end at,
// which is inside the stretch the near member's projected segment covers.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertLength,
  assertLessThan,
  assertTrue,
} from "../assert";
import { CAMERA_TARGET } from "../constants";
import { clearAll, createHarness, openSite, type Harness } from "../harness";

/** The camera pose the scenario is read through: yaw `45` puts it on `x = z`. */
const CAMERA = { yaw: 45, pitch: 30, dist: 40 } as const;

/** The far member, placed first, so it carries id `0`. */
const FAR = {
  a: { x: -8, y: 4, z: -8 },
  b: { x: -8, y: 8, z: -8 },
} as const;

/** The near member, placed second, so it carries id `1`. */
const NEAR = {
  a: { x: 4, y: 10, z: 4 },
  b: { x: 4, y: 14, z: 4 },
} as const;

/** Where the camera stands, as `specs/controls.md` § The camera fixes it. */
function eyeOf(camera: { yaw: number; pitch: number; dist: number }): {
  x: number;
  y: number;
  z: number;
} {
  const yaw = (camera.yaw * Math.PI) / 180;
  const pitch = (camera.pitch * Math.PI) / 180;
  const flat = camera.dist * Math.cos(pitch);
  return {
    x: CAMERA_TARGET.x + flat * Math.cos(yaw),
    y: CAMERA_TARGET.y + camera.dist * Math.sin(pitch),
    z: CAMERA_TARGET.z + flat * Math.sin(yaw),
  };
}

/** The straight-line distance between two world positions. */
function gap(
  a: { x: number; y: number; z: number },
  b: { x: number; y: number; z: number },
): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("answers a member tie with the member nearest the camera", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await h.debug.setCamera(CAMERA.yaw, CAMERA.pitch, CAMERA.dist);
  await h.debug.addMember(
    FAR.a.x,
    FAR.a.y,
    FAR.a.z,
    FAR.b.x,
    FAR.b.y,
    FAR.b.z,
    "strut",
  );
  await h.debug.addMember(
    NEAR.a.x,
    NEAR.a.y,
    NEAR.a.z,
    NEAR.b.x,
    NEAR.b.y,
    NEAR.b.z,
    "strut",
  );

  const posed = await h.snapshot();
  assertLength(
    posed.structure.members,
    2,
    "the two members the scenario places, both accepted (specs/structure.md)",
  );
  assertEqual(
    posed.camera.yaw,
    CAMERA.yaw,
    "the camera yaw the pick is read at",
  );

  // The near member is nearer the camera along its whole length than the far
  // member's nearest point is, so whichever point of each segment the click
  // lands on, the camera rule can only answer the near one. Read off the camera
  // pose the specification fixes, not off the build.
  const eye = eyeOf(posed.camera);
  assertLessThan(
    Math.max(gap(eye, NEAR.a), gap(eye, NEAR.b)),
    Math.min(gap(eye, FAR.a), gap(eye, FAR.b)),
    "the near member's distance from the camera, against the far member's",
  );

  // The click: the point the build drew the far member's lower end at. Both
  // members lie in the plane `x = z`, so it sits on the near member's projected
  // segment too — which is what makes the two screen distances tie.
  const click = await h.project(FAR.a.x, FAR.a.y, FAR.a.z);
  const nearTop = await h.project(NEAR.b.x, NEAR.b.y, NEAR.b.z);
  const nearBottom = await h.project(NEAR.a.x, NEAR.a.y, NEAR.a.z);
  assertTrue(click.visible, "the point the click is made at is on the stage");
  assertTrue(
    Math.abs(click.x - nearTop.x) < 0.5 &&
      Math.abs(click.x - nearBottom.x) < 0.5,
    "the near member drawn on the same stage line as the click, which the " +
      "plane x = z the camera stands on puts it on",
  );
  assertTrue(
    click.y > Math.min(nearTop.y, nearBottom.y) &&
      click.y < Math.max(nearTop.y, nearBottom.y),
    "the click inside the stretch of stage the near member's segment covers, " +
      "so the two projected segments are the same zero distance from it",
  );

  await h.pointerMove(click.x, click.y);
  await h.advance(1);
  await h.capture("state", "the pointer where both members are drawn");

  assertEqual(
    (await h.snapshot()).pick.member,
    1,
    "the member a click there would take: the two projected segments are the " +
      "same distance from the click, so the tie falls to the member whose " +
      "nearest point is nearest the camera (specs/controls.md)",
  );
});
