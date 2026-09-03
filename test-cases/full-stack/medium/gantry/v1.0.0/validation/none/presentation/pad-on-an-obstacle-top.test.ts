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
// THE SCENARIO IS SITE FIVE'S OWN LIFT. `High Shelf` carries one obstacle, the
// platform whose minimum corner is `(-9, 0, -2)` and whose size is `(4, 6, 4)`,
// and asks for its container on `(-7, 8, 0)` at yaw `90` (specs/sites.md). A
// container is `4 x 2 x 2` and a target pose is the pose of the lift point, the
// centre of the load's top face (specs/world.md), so a container resting on that
// pad stands on the platform's top face at `y = 6` — which is where its footprint
// belongs, six units above the ground the platform stands on. The yard is emptied
// of everything but that one load and the platform it is wanted on, and nothing
// is built.
//
// THE PAD IS MOVED RATHER THAN THE LOAD REMOVED, so the one thing that differs
// between the two pictures is where the pad is: `setLoadTarget` "sets the target
// pose of the load at `index`, which is the pad it must be set down on"
// (specs/instrumentation.md) and touches nothing else, so the load's own body,
// the platform, and the camera all stand exactly as they stood.
//
// WHAT THE READING CAN AND CANNOT DECIDE. It decides that the footprint is drawn
// on the platform's top face, at the four corners of the container's footprint
// turned to the target yaw — `(-7 ± 1, 6, 0 ± 2)` — and that the rest of that
// top face is left alone. It cannot decide that the pad is NOT also drawn on the
// ground under the platform, because the platform stands on that ground and hides
// it from every camera pose; that half of the requirement is unobservable and is
// left unasserted rather than asserted against the reference's own choice.

import { afterEach, beforeEach, it } from "vitest";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import {
  assertEqual,
  assertGreaterThan,
  assertLessThanOrEqual,
  assertTrue,
} from "../assert";
import { LOAD_CLASS_DIMENSIONS, STAGE_H, STAGE_W } from "../constants";
import { addOneLoad, createHarness, openSite, type Harness } from "../harness";

/** High Shelf: the site whose container is wanted on top of its platform. */
const SITE = 4;

/** That lift, as specs/sites.md authors it. */
const CLASS = "container";
const MASS = 80;
const START = { x: 8, y: 2, z: 0, yaw: 0 } as const;
const TARGET = { x: -7, y: 8, z: 0, yaw: 90 } as const;

/** The platform's top face, from the site's own obstacle box. */
const TOP_Y = 6;

/** Where the pad is sent so the second picture has none on the platform. */
const ELSEWHERE = { x: 6, y: 2, z: 6, yaw: 90 } as const;

/** How far two colours must stand apart, of the 441 the colour cube spans. */
const CHANGED = 50;
/** Slack on a point the outline is drawn at, in logical pixels. */
const ON_TOLERANCE = 3;
/** Slack on a point it may not reach, in logical pixels. */
const OFF_TOLERANCE = 3;

/** How many of the footprint's four corners the pad has to be drawn at. */
const MOST = 3;

interface Picture {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}
interface At {
  x: number;
  y: number;
}

async function picture(harness: Harness): Promise<Picture> {
  const png = await harness.page.screenshot({ type: "png" });
  const image = await loadImage(png);
  const canvas = createCanvas(image.width, image.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(image, 0, 0);
  const { data } = ctx.getImageData(0, 0, image.width, image.height);
  return { width: image.width, height: image.height, data };
}

function colorAt(shot: Picture, at: At): [number, number, number] {
  const x = Math.min(
    Math.max(Math.round((at.x / STAGE_W) * shot.width), 0),
    shot.width - 1,
  );
  const y = Math.min(
    Math.max(Math.round((at.y / STAGE_H) * shot.height), 0),
    shot.height - 1,
  );
  const i = (y * shot.width + x) * 4;
  return [shot.data[i]!, shot.data[i + 1]!, shot.data[i + 2]!];
}

function apart(a: readonly number[], b: readonly number[]): number {
  return Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);
}

function changeNear(a: Picture, b: Picture, at: At, radius: number): number {
  let most = 0;
  for (let dy = -radius; dy <= radius; dy += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      if (dx * dx + dy * dy > radius * radius) continue;
      const point = { x: at.x + dx, y: at.y + dy };
      most = Math.max(most, apart(colorAt(a, point), colorAt(b, point)));
    }
  }
  return most;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("marks the pad on the obstacle's top face at the target height", async () => {
  await openSite(h, SITE);
  await h.debug.clearStructure();
  await addOneLoad(h, CLASS, MASS, START, TARGET);
  await h.advance(1);
  await h.capture("shelf-pad", "The pad marked on the platform's top");

  const site = await h.snapshot();
  assertEqual(
    site.site.obstacles.length,
    1,
    "the obstacles High Shelf carries, the platform this point's pad sits on " +
      "(specs/sites.md)",
  );
  const platform = site.site.obstacles[0]!;
  assertEqual(
    platform.min.y + platform.size.y,
    TOP_Y,
    "the height of the platform's top face, which the container's target pose " +
      "rests its footprint on (specs/world.md § Obstacles)",
  );

  // The container's footprint at yaw 90: two units along x, four along z,
  // centred under the target position, on the platform's top face.
  const size = LOAD_CLASS_DIMENSIONS[CLASS];
  const corners: { where: string; x: number; z: number }[] = [];
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      corners.push({
        where: `(${TARGET.x + (sx * size.z) / 2}, ${TOP_Y}, ${
          TARGET.z + (sz * size.x) / 2
        })`,
        x: TARGET.x + (sx * size.z) / 2,
        z: TARGET.z + (sz * size.x) / 2,
      });
    }
  }
  // The rest of the platform's top: the strips either side of the footprint.
  const rest = [
    { where: `(${TARGET.x + 1.6}, ${TOP_Y}, 0)`, x: TARGET.x + 1.6, z: 0 },
    { where: `(${TARGET.x - 1.6}, ${TOP_Y}, 0)`, x: TARGET.x - 1.6, z: 0 },
  ];

  const where = new Map<string, At>();
  for (const point of [...corners, ...rest]) {
    const at = await h.project(point.x, TOP_Y, point.z);
    assertTrue(
      at.visible,
      `the platform's top face at ${point.where} to be drawn on the stage at ` +
        "the start camera pose, so this point has a picture to read " +
        "(specs/instrumentation.md)",
    );
    where.set(point.where, at);
  }

  const before = await picture(h);
  await h.debug.setLoadTarget(
    0,
    ELSEWHERE.x,
    ELSEWHERE.y,
    ELSEWHERE.z,
    ELSEWHERE.yaw,
  );
  await h.advance(1);
  const after = await picture(h);

  assertGreaterThan(
    corners.filter(
      (corner) =>
        changeNear(before, after, where.get(corner.where)!, ON_TOLERANCE) >
        CHANGED,
    ).length,
    MOST - 1,
    "the corners of the container's footprint on the platform's top face — " +
      `${corners.map((corner) => corner.where).join(", ")} — that the pad is ` +
      "drawn at, out of 4, since a target pose on an obstacle is drawn as a " +
      "footprint on that obstacle's top (specs/world.md § Pads)",
  );

  for (const point of rest) {
    assertLessThanOrEqual(
      changeNear(before, after, where.get(point.where)!, OFF_TOLERANCE),
      CHANGED,
      `the platform's top face at ${point.where}, outside the container's ` +
        "footprint, which moving the pad may not change because a pad is the " +
        "class outline at the target pose rather than a mark over the whole " +
        "face (specs/world.md § Pads)",
    );
  }
});
