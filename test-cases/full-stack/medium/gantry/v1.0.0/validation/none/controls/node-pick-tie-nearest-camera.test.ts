// controls/node-pick-tie-nearest-camera — two nodes tied under the pointer, and
// the candidate is the one nearest the camera.
//
// `specs/controls.md` § Clicks and drags: "the candidate is the nearest at most
// `NODE_PICK_PX` (`20`) logical pixels from the click, ties going to the node
// nearest the camera, and then to the node lower in `x`, then in `y`, then in
// `z`." This check is about the FIRST of those two tie-breaks, so the scenario
// has to tie the screen distance exactly.
//
// A LINE OF NODES ON THE CAMERA'S OWN AXIS TIES IT EXACTLY. The camera looks from
// its eye at `CAMERA_TARGET`, and `specs/controls.md` fixes where that eye stands,
// so the axis between them is fixed too. Posed at yaw `0`, pitch
// `atan(RISE / RUN)` and distance `DIST`, that axis runs through `CAMERA_TARGET`
// (`(0, 6, 0)`) along `(RUN, RISE, 0)` — a direction whose steps land on lattice
// nodes. Every one of those nodes is drawn at the same point of the stage,
// whatever lens the build draws through, so a click there is the same distance
// from all of them and only the camera rule can separate them.
//
// THE CLICK IS MADE AT THE FARTHEST OF THEM. A build that never reaches the tie
// rule answers the node the click is exactly on, which is the farthest; the
// stated rule answers the nearest, which is the node the axis reaches last before
// the camera. The two are twenty-two units apart in the yard.
//
// The distance is chosen so the whole line stands in FRONT of the camera: the
// next node along would be behind it, and it lies outside the envelope, so no
// node in this scenario is excluded for standing behind the eye.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLessThan, assertTrue } from "../assert";
import { CAMERA_TARGET, SITES } from "../constants";
import { clearAll, createHarness, openSite, type Harness } from "../harness";

/** The site this check is read on. */
const SITE = 0;

/** The lattice step the camera axis is posed along: `(RUN, RISE, 0)`. */
const RUN = 4;
const RISE = 2;

/** How far the camera stands from `CAMERA_TARGET`, along that axis. */
const DIST = 16;

/** The steps along the axis that stay inside site 1's envelope. */
const STEPS = [-2, -1, 0, 1, 2, 3] as const;

/** A position, in world units. */
interface Vec {
  x: number;
  y: number;
  z: number;
}

/** The node `step` steps along the camera axis from `CAMERA_TARGET`. */
function nodeAt(step: number): Vec {
  return {
    x: CAMERA_TARGET.x + step * RUN,
    y: CAMERA_TARGET.y + step * RISE,
    z: CAMERA_TARGET.z,
  };
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

it("answers a node tie with the node nearest the camera", async () => {
  await openSite(h, SITE);
  await clearAll(h);
  const pitch = (Math.atan2(RISE, RUN) * 180) / Math.PI;
  await h.debug.setCamera(0, pitch, DIST);
  const camera = (await h.snapshot()).camera;
  assertEqual(camera.yaw, 0, "the camera yaw the tie is posed at");
  assertEqual(camera.dist, DIST, "the camera distance the tie is posed at");

  // Every node of the line stands inside the envelope and in front of the eye,
  // and the tie is between the two ends of it.
  const eye = eyeOf(camera);
  const envelope = SITES[SITE]!.envelope;
  const line = STEPS.map(nodeAt);
  const reach = (p: Vec): number =>
    Math.hypot(p.x - eye.x, p.y - eye.y, p.z - eye.z);
  for (const node of line) {
    assertTrue(
      node.x >= envelope.x.min &&
        node.x <= envelope.x.max &&
        node.y >= envelope.y.min &&
        node.y <= envelope.y.max &&
        node.z >= envelope.z.min &&
        node.z <= envelope.z.max,
      `the node (${node.x}, ${node.y}, ${node.z}) stands inside the envelope`,
    );
    assertLessThan(
      reach(node),
      DIST + Math.hypot(RUN, RISE) * (line.length - 1),
      `the node (${node.x}, ${node.y}, ${node.z}) stands in front of the eye`,
    );
  }
  const nearest = line.reduce((one, other) =>
    reach(other) < reach(one) ? other : one,
  );
  const farthest = line.reduce((one, other) =>
    reach(other) > reach(one) ? other : one,
  );

  // The build draws the whole line at one point of the stage, which is what
  // makes the screen distances tie: read that back before the click is made.
  const drawn = [];
  for (const node of line) drawn.push(await h.project(node.x, node.y, node.z));
  const at = drawn[0]!;
  for (const point of drawn) {
    assertTrue(
      Math.hypot(point.x - at.x, point.y - at.y) < 0.5,
      "the nodes of the camera's own axis drawn at one point of the stage, " +
        "which is what ties their distance from the click",
    );
  }
  assertTrue(at.visible, "that point is on the stage");

  const click = await h.project(farthest.x, farthest.y, farthest.z);
  await h.pointerMove(click.x, click.y);
  await h.advance(1);
  await h.capture(
    "state",
    "the pointer where a line of nodes is drawn at once",
  );

  assertEqual(
    JSON.stringify((await h.snapshot()).pick.node),
    JSON.stringify(nearest),
    "the node a click on that point would take: every node of the line is the " +
      "same distance from the click, so the tie falls to the one nearest the " +
      `camera — ${reach(nearest).toFixed(1)} units from the eye against ` +
      `${reach(farthest).toFixed(1)} for the node the click is drawn on ` +
      "(specs/controls.md)",
  );
});
