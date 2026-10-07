// controls/node-pick-considers-nodes-in-front-of-the-camera-only — a lattice node
// standing behind the camera is never the candidate.
//
// `specs/controls.md` § Clicks and drags: "A node pick considers every lattice
// node in the envelope that stands IN FRONT OF THE CAMERA, projected to the
// stage". A node behind the eye has no place on the stage at all, and the
// arithmetic that draws one in front will happily answer for one behind — the
// same point, mirrored — so a build that skipped that test would offer it as a
// candidate wherever the mirrored answer happens to land.
//
// THE SCENARIO PUTS ONE BEHIND THE CAMERA, ON THE CAMERA'S OWN AXIS. Posed at yaw
// `0`, pitch `atan(RISE / RUN)` and distance `DIST`, the camera's eye stands on
// the line through `CAMERA_TARGET` (`(0, 6, 0)`) along `(RUN, RISE, 0)`, between
// the two lattice nodes of that line which fall inside site 1's envelope: the
// target itself, `DIST` units in front of the eye, and `BEHIND` — the next step
// along — a third of a unit behind it. A node on the axis is drawn at the middle
// of the stage whichever side of the eye it is on, so the mirrored answer for the
// one behind lands exactly where the one in front is drawn, and it stands far
// nearer the camera, which is the tie-break a build would then apply.
//
// So a click at the point the build says it drew `CAMERA_TARGET` at answers the
// target on a build that considers what stands in front of the camera, and the
// node behind it on a build that does not. No other lattice node of the envelope
// lies on that axis: the step before the target leaves the envelope.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLessThan, assertTrue } from "../assert";
import { CAMERA_TARGET, SITES } from "../constants";
import {
  createHarness,
  emptyYard,
  openSite,
  runTicks,
  type Harness,
} from "../harness";

/** The site this check is read on. */
const SITE = 0;

/** The lattice step the camera axis is posed along: `(RUN, RISE, 0)`. */
const RUN = 10;
const RISE = 4;

/** How far the camera stands from `CAMERA_TARGET`: inside that step. */
const DIST = 10.4;

/** The node in front of the camera, at the target, and the one behind it. */
const FRONT = { x: CAMERA_TARGET.x, y: CAMERA_TARGET.y, z: CAMERA_TARGET.z };
const BEHIND = {
  x: CAMERA_TARGET.x + RUN,
  y: CAMERA_TARGET.y + RISE,
  z: CAMERA_TARGET.z,
};

/** A position, in world units. */
interface Vec {
  x: number;
  y: number;
  z: number;
}

/** Where the camera stands (`specs/controls.md` § The camera). */
function eyeOf(camera: { yaw: number; pitch: number; dist: number }): Vec {
  const yaw = (camera.yaw * Math.PI) / 180;
  const pitch = (camera.pitch * Math.PI) / 180;
  const flat = camera.dist * Math.cos(pitch);
  return {
    x: CAMERA_TARGET.x + flat * Math.cos(yaw),
    y: CAMERA_TARGET.y + camera.dist * Math.sin(pitch),
    z: CAMERA_TARGET.z + flat * Math.sin(yaw),
  };
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("takes the node in front of the camera, never the one behind it", async () => {
  await openSite(h, SITE);
  // The YARD AND THE STRUCTURE, rather than the whole world: a site opens with an
  // empty tape (`specs/state.md`) and nothing here poses one, so the tape needs no
  // clearing and the program screen is never visited.
  await emptyYard(h);
  await h.debug.clearStructure();
  const pitch = (Math.atan2(RISE, RUN) * 180) / Math.PI;
  await h.debug.setCamera(0, pitch, DIST);
  const camera = (await h.snapshot()).camera;
  assertEqual(camera.yaw, 0, "the camera yaw the scenario is posed at");
  assertEqual(
    camera.dist,
    DIST,
    "the camera distance the scenario is posed at",
  );

  // Both nodes stand inside the envelope; one is in front of the eye and the
  // other is behind it, and the one behind stands far the nearer of the two.
  const envelope = SITES[SITE]!.envelope;
  for (const node of [FRONT, BEHIND]) {
    assertTrue(
      node.x >= envelope.x.min &&
        node.x <= envelope.x.max &&
        node.y >= envelope.y.min &&
        node.y <= envelope.y.max &&
        node.z >= envelope.z.min &&
        node.z <= envelope.z.max,
      `the node (${node.x}, ${node.y}, ${node.z}) stands inside the envelope`,
    );
  }
  const eye = eyeOf(camera);
  const reach = (p: Vec): number =>
    Math.hypot(p.x - eye.x, p.y - eye.y, p.z - eye.z);
  const along = Math.hypot(RUN, RISE);
  assertLessThan(
    DIST,
    along,
    `the camera's distance from the target, against the ${along.toFixed(3)} ` +
      `units to (${BEHIND.x}, ${BEHIND.y}, ${BEHIND.z}) along the same line: ` +
      "the eye stands between them, so that node is behind the camera",
  );
  assertLessThan(
    reach(BEHIND),
    reach(FRONT),
    "the node behind the camera's distance from the eye, against the one in " +
      "front: the node behind is the nearer, so a build that considered it " +
      "would answer with it",
  );

  const at = await h.project(FRONT.x, FRONT.y, FRONT.z);
  assertTrue(at.visible, "the node in front of the camera is on the stage");
  await h.pointerMove(at.x, at.y);
  // The frame and the reading in one crossing: `runTicks` answers with the state
  // the ticks it drove left (`validation/harness.ts`).
  const seen = await runTicks(h, 1);
  await h.capture("state", "the pointer on the node at the camera's target");

  assertEqual(
    JSON.stringify(seen.pick.node),
    JSON.stringify(FRONT),
    "the node a click there would take: a node pick considers the lattice " +
      `nodes standing in front of the camera, so (${BEHIND.x}, ${BEHIND.y}, ` +
      `${BEHIND.z}), which stands behind the eye on the same axis, is no ` +
      "candidate however near it is drawn (specs/controls.md)",
  );
});
