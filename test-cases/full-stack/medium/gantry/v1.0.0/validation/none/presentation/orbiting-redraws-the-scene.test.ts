// presentation/orbiting-redraws-the-scene — turning the camera redraws the yard
// from the new pose.
//
// specs/overview.md, "Hard requirements": "Render a real 3D scene on the canvas:
// the yard, the lattice aids, the crane's members and parts, the loads, and the
// readouts, with a camera the player orbits." specs/controls.md, "The camera":
// the build, program, and run screens "show the 3D yard through an orbit camera",
// and `setCamera` poses that camera's yaw, pitch, and distance.
//
// WHAT THAT MEANS FOR THE PICTURE, and it is the whole of what this point
// decides: a thing standing at a world position is drawn where the camera puts
// it, so moving the camera moves the drawing. A build that painted a fixed
// picture of a yard — a backdrop, a pre-rendered still — would answer the same
// pixels from every pose and fail here, which is exactly the failure the
// requirement is written against.
//
// THE READING IS A REMOVAL AT THE SECOND POSE, not a comparison of the two
// poses. Two frames from two camera poses differ everywhere, so comparing them
// says nothing about WHERE the member went. So the camera is turned, the frame is
// photographed, the member is taken away, and the frame is photographed again:
// what parted between those two is the member alone, and this point asks that it
// parted at the point the build's own `project` now puts the member's middle at,
// and did not part at the point `project` put it at before the turn.
//
// THE MEMBER STANDS ALONE IN AN EMPTIED YARD — no other structure, no loads, no
// obstacles — and is a horizontal strut far out along `+x`, which is where the
// two poses this point uses carry it furthest apart on the stage and clear of
// the readouts on either side.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertGreaterThan,
  assertLessThanOrEqual,
  assertTrue,
} from "../assert";
import {
  CAMERA_START_DIST,
  CAMERA_START_PITCH,
  CAMERA_START_YAW,
  STAGE_H,
  STAGE_W,
} from "../constants";
import { clearAll, createHarness, openSite, type Harness } from "../harness";

const SITE = 0;

/** The member: a horizontal strut, well out along `+x`, inside every envelope. */
const FROM = { x: 8, y: 6, z: 0 } as const;
const TO = { x: 12, y: 6, z: 0 } as const;
const MIDDLE = { x: 10, y: 6, z: 0 } as const;

/** The second camera pose: a quarter turn around the yard, nothing else moved. */
const TURNED_YAW = CAMERA_START_YAW + 90;

/**
 * How far the two projected middles must lie apart, in logical pixels.
 *
 * Not a figure the specification states — it is this scenario's own headroom.
 * The two points have to be far enough apart that a member drawn at one is
 * plainly not covering the other: the member is at most a few tens of pixels
 * wide on screen, so a hundred pixels is several times its own drawn width.
 */
const SEPARATION = 100;

/** A change in the picture that is a thing being drawn, out of 441. */
const DREW = 50;

/** A difference small enough to be anti-aliasing rather than a drawing. */
const UNCHANGED = 25;

/* -------------------------------------------------------------------------- */
/* Reading the picture                                                        */
/* -------------------------------------------------------------------------- */
//
// An engineless build draws the yard through WebGL, so nothing here reads pixels
// off a 2D context: what a check reads is the page's own composited frame, taken
// with `page.screenshot` — the same picture `h.capture` writes as the review
// item's evidence. The PNG goes back INTO the page to be decoded, because the
// page carries an image decoder and this process carries none.
//
// A point is addressed in LOGICAL STAGE UNITS, the units `project` answers in
// and the units `specs/overview.md` lays the stage out in, and the canvas's own
// box on the page is what turns one into the other: the stage is fitted into it
// at one uniform scale, centred, exactly as that file states.

/** A colour read off the frame, each channel 0-255. */
type Rgb = readonly [number, number, number];

/** One composited frame, read at logical stage points. */
interface Frame {
  at(x: number, y: number): Rgb;
}

/** How far apart two colours are, on the 0-441 (`sqrt(3) * 255`) scale. */
function apart(a: Rgb, b: Rgb): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/** The picture on screen right now, as a colour lookup in stage units. */
async function readFrame(h: Harness): Promise<Frame> {
  const box = (await h.page.evaluate(() => {
    const canvas = document.querySelector("canvas");
    if (canvas === null) return null;
    const at = canvas.getBoundingClientRect();
    return { x: at.x, y: at.y, width: at.width, height: at.height };
  })) as { x: number; y: number; width: number; height: number } | null;
  assertTrue(
    box !== null,
    "a <canvas> on the page for the build to draw the yard in",
  );
  const shot = (await h.page.screenshot({ type: "png" })).toString("base64");
  const decoded = (await h.page.evaluate(async (png: string) => {
    const image = new Image();
    image.src = `data:image/png;base64,${png}`;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext("2d")!;
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, image.width, image.height);
    // Base64 rather than an array of numbers: a whole frame is two million
    // entries, and it is built in chunks because `String.fromCharCode` is
    // applied to its arguments and that many of them overflow the stack.
    let binary = "";
    const chunk = 0x8000;
    for (let i = 0; i < pixels.data.length; i += chunk) {
      binary += String.fromCharCode(...pixels.data.subarray(i, i + chunk));
    }
    return { width: image.width, height: image.height, b64: btoa(binary) };
  }, shot)) as { width: number; height: number; b64: string };
  const bytes = Buffer.from(decoded.b64, "base64");
  const fit = box as { x: number; y: number; width: number; height: number };
  const scale = Math.min(fit.width / STAGE_W, fit.height / STAGE_H);
  const originX = fit.x + (fit.width - STAGE_W * scale) / 2;
  const originY = fit.y + (fit.height - STAGE_H * scale) / 2;
  return {
    at(x, y) {
      const px = Math.round(originX + x * scale);
      const py = Math.round(originY + y * scale);
      if (px < 0 || py < 0 || px >= decoded.width || py >= decoded.height) {
        return [0, 0, 0];
      }
      const at = (py * decoded.width + px) * 4;
      return [bytes[at]!, bytes[at + 1]!, bytes[at + 2]!];
    },
  };
}
let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws the member at its new projected point and no longer at the old one", async () => {
  await openSite(h, SITE);
  await clearAll(h);
  await h.debug.setCamera(
    CAMERA_START_YAW,
    CAMERA_START_PITCH,
    CAMERA_START_DIST,
  );
  await h.debug.addMember(FROM.x, FROM.y, FROM.z, TO.x, TO.y, TO.z, "strut");
  await h.advance(1);

  const posed = await h.snapshot();
  assertTrue(
    posed.structure.members.length === 1,
    "the one member this point poses to stand in the emptied yard " +
      "(specs/structure.md)",
  );

  const before = await h.project(MIDDLE.x, MIDDLE.y, MIDDLE.z);
  assertTrue(
    before.visible,
    `the member's middle (${MIDDLE.x}, ${MIDDLE.y}, ${MIDDLE.z}) to be drawn ` +
      `on the stage at yaw ${CAMERA_START_YAW}, which this point needs a ` +
      "picture of (specs/instrumentation.md)",
  );

  await h.debug.setCamera(TURNED_YAW, CAMERA_START_PITCH, CAMERA_START_DIST);
  await h.advance(1);

  const after = await h.project(MIDDLE.x, MIDDLE.y, MIDDLE.z);
  assertTrue(
    after.visible,
    `the member's middle to be drawn on the stage at yaw ${TURNED_YAW} too, ` +
      "so this point can read where the turn carried it " +
      "(specs/instrumentation.md)",
  );
  assertGreaterThan(
    Math.hypot(after.x - before.x, after.y - before.y),
    SEPARATION,
    `the two projected middles, ${SEPARATION} logical pixels apart, which is ` +
      `what turning the camera from yaw ${CAMERA_START_YAW} to ` +
      `${TURNED_YAW} moves a position this far out in the yard ` +
      "(specs/controls.md)",
  );
  assertTrue(
    after.x >= 0 && after.x < STAGE_W && after.y >= 0 && after.y < STAGE_H,
    "the turned camera's projected middle to lie on the stage",
  );

  const drawn = await readFrame(h);
  await h.capture("orbited", "The same crane from two camera poses");

  await h.debug.removeMember(0);
  await h.advance(1);
  const without = await readFrame(h);

  assertGreaterThan(
    apart(drawn.at(after.x, after.y), without.at(after.x, after.y)),
    DREW,
    `the member to be painted at (${after.x.toFixed(0)}, ` +
      `${after.y.toFixed(0)}), the point the camera at yaw ${TURNED_YAW} ` +
      "draws its middle at, since the yard is drawn through the camera the " +
      "player orbits (specs/overview.md)",
  );
  assertLessThanOrEqual(
    apart(drawn.at(before.x, before.y), without.at(before.x, before.y)),
    UNCHANGED,
    `the member NOT to be painted at (${before.x.toFixed(0)}, ` +
      `${before.y.toFixed(0)}) any more, the point the camera drew its ` +
      `middle at before the turn: a scene drawn through the orbit camera ` +
      "leaves the old point behind (specs/overview.md)",
  );
});
