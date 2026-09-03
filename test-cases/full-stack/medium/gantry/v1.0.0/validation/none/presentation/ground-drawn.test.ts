// presentation/ground-drawn — the plane y = 0 is drawn as the yard floor.
//
// specs/world.md § The world frame: "The world is measured in units on a
// right-handed frame: `x` and `z` are horizontal, `y` is up, and THE GROUND IS
// THE PLANE `y = 0`, DRAWN AS THE YARD FLOOR." specs/ui.md § Build puts it in the
// list of what the build screen shows: "`build` shows the yard through the
// camera: THE GROUND, the lattice and envelope aids, the anchors, the obstacles,
// the loads at their starting poses, the pads, and the structure as built."
//
// A FLOOR IS ONLY LEGIBLE AGAINST WHAT IS NOT FLOOR, so the camera is posed to
// the shallowest pitch its own limits allow — `CAMERA_PITCH_MIN`, a pose the
// orbit controls reach (specs/controls.md) — which brings the ground plane's own
// vanishing line into the frame. At the start pose the camera looks down steeply
// enough that the horizon is off the top of the stage and there is nothing in
// frame that is not yard, so the reading cannot be taken there.
//
// WHERE THE HORIZON IS COMES FROM THE BUILD ITSELF. A ground point taken far away
// in the direction the camera looks projects onto the ground plane's vanishing
// line, and `project` answers "where `(x, y, z)` is drawn, through the camera as
// it stands" (specs/instrumentation.md). So the line dividing the two halves of
// this reading is the build's own arithmetic rather than a camera of the
// validator's, and each pair of samples is a column: a point of the ground plane,
// and the stage a good way above the horizon over the same column.
//
// EVERY COLOUR IS A MEDIAN rather than one pixel. The build screen also draws
// "the lattice and envelope aids" (specs/ui.md § Build), which are lines and dots
// standing on the ground and rising above the horizon, and a single pixel that
// landed on one would report the aid's colour rather than the floor's or the
// sky's. So the sky is the median of a row spread across the stage above the
// horizon, and each ground reading is the median of a small patch around the
// point: the aids are a minority of either and the median is what the surface
// under them is drawn in.
//
// WHAT IT DECIDES. A build that draws no floor shows its background wherever the
// ground plane is, so those columns read the same above and below the horizon. A
// build that draws one shows something else, and the pair stands apart. Nothing
// here reads a colour VALUE: "The yard is yours to art-direct: the palette, the
// sky, the ground, the light" (specs/overview.md § Visual design), so the only
// reading is that the floor is not the sky.

import { afterEach, beforeEach, it } from "vitest";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import {
  assertBetween,
  assertEqual,
  assertGreaterThan,
  assertTrue,
} from "../assert";
import {
  CAMERA_PITCH_MIN,
  CAMERA_START_DIST,
  CAMERA_START_YAW,
  STAGE_H,
  STAGE_W,
} from "../constants";
import { createHarness, emptyYard, openSite, type Harness } from "../harness";

const SITE = 0;

/** How far away a ground point is taken to stand on the vanishing line. */
const FAR = 4000;

/** How far above the horizon the sky is sampled, in logical pixels. */
const ABOVE = 80;
/** How far below it a ground sample has to stand to be read, logical pixels. */
const BELOW = 80;

/**
 * Points of the ground plane, spread across the yard.
 *
 * Off the lattice nodes, and off the diagonal `x = z`, which at the start yaw is
 * the line the camera looks along and so the column the envelope aid's near and
 * far vertical edges both stand in.
 */
const GROUND = [
  { x: 7, z: 1 },
  { x: 5, z: -3 },
  { x: -1, z: 7 },
  { x: 3, z: -1 },
] as const;

/** How wide a ground reading's patch is, in logical pixels either way. */
const PATCH = 3;

/** How many points the sky reading spreads over, and the band it spreads in. */
const SKY_SAMPLES = 11;
const SKY_FROM = 200;
const SKY_TO = 1100;

/** How far two colours must stand apart, of the 441 the colour cube spans. */
const CHANGED = 50;

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
  // One held frame first: the page is off its own paint clock (see
  // `paint-gate.js`), and a screenshot is the whole page rather than just the
  // canvas `advance` has already drawn.
  await harness.paintFrame();
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

/** What a run of points is drawn in, channel by channel, ignoring outliers. */
function medianColor(
  shot: Picture,
  points: readonly At[],
): [number, number, number] {
  const channels: number[][] = [[], [], []];
  for (const at of points) {
    const rgb = colorAt(shot, at);
    for (const channel of [0, 1, 2]) channels[channel]!.push(rgb[channel]!);
  }
  const middle = (values: number[]): number => {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)]!;
  };
  return [middle(channels[0]!), middle(channels[1]!), middle(channels[2]!)];
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws the plane y = 0 as a floor under the yard", async () => {
  await openSite(h, SITE);
  await emptyYard(h);
  await h.debug.clearStructure();
  await h.debug.setCamera(
    CAMERA_START_YAW,
    CAMERA_PITCH_MIN,
    CAMERA_START_DIST,
  );
  await h.advance(1);
  await h.capture("floor", "The empty yard, floor against sky");

  const posed = await h.snapshot();
  assertEqual(posed.screen, "build", "the screen opening a site shows");
  assertEqual(
    posed.camera.pitch,
    CAMERA_PITCH_MIN,
    "the camera pitch this reading is taken at, the shallowest the limits " +
      "allow (specs/controls.md)",
  );

  // The ground plane's vanishing line, from the build's own projection: a
  // ground point taken far away in the direction the camera looks.
  const horizon = await h.project(-FAR, 0, -FAR);
  assertBetween(
    horizon.y,
    ABOVE,
    STAGE_H - BELOW,
    `the stage row the ground plane vanishes on at pitch ${CAMERA_PITCH_MIN}, ` +
      "which this reading needs in frame so that there is stage above the " +
      "ground plane and stage on it (specs/world.md § The world frame)",
  );

  const shot = await picture(h);
  const skyRow: At[] = [];
  for (let i = 0; i < SKY_SAMPLES; i += 1) {
    skyRow.push({
      x: SKY_FROM + ((SKY_TO - SKY_FROM) * i) / (SKY_SAMPLES - 1),
      y: horizon.y - ABOVE,
    });
  }
  const sky = medianColor(shot, skyRow);

  const same: string[] = [];
  for (const point of GROUND) {
    const at = await h.project(point.x, 0, point.z);
    assertTrue(
      at.visible,
      `the ground point (${point.x}, 0, ${point.z}) to be drawn on the stage ` +
        `at pitch ${CAMERA_PITCH_MIN}, so this point has a picture to read ` +
        "(specs/instrumentation.md)",
    );
    assertGreaterThan(
      at.y,
      horizon.y + BELOW,
      `the stage row the ground point (${point.x}, 0, ${point.z}) is drawn ` +
        "on, which has to sit well below the horizon for the pair to be a " +
        "floor and a sky rather than two points either side of a line",
    );
    const patch: At[] = [];
    for (let dy = -PATCH; dy <= PATCH; dy += 1) {
      for (let dx = -PATCH; dx <= PATCH; dx += 1) {
        patch.push({ x: at.x + dx, y: at.y + dy });
      }
    }
    const floor = medianColor(shot, patch);
    if (apart(floor, sky) <= CHANGED) {
      same.push(
        `(${point.x}, 0, ${point.z}) at (${at.x.toFixed(0)}, ` +
          `${at.y.toFixed(0)}) reads [${floor.join(", ")}] and the stage ` +
          `above the horizon reads [${sky.join(", ")}]`,
      );
    }
  }

  assertEqual(
    same.join("; "),
    "",
    "every sampled point of the plane y = 0 to be drawn as something other " +
      `than the stage ${ABOVE} logical pixels above the horizon, ` +
      "since the ground is the plane y = 0 drawn as the yard floor and the " +
      "build screen shows it (specs/world.md § The world frame, specs/ui.md " +
      "§ Build)",
  );
});
