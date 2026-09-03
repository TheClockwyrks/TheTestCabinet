// presentation/member-drawn-at-its-projected-segment — a placed member is drawn
// along the segment joining its two nodes' projected points.
//
// specs/ui.md, "Build": `build` "shows the yard through the camera: the ground,
// the lattice and envelope aids, the anchors, the obstacles, the loads at their
// starting poses, the pads, and the structure as built". specs/overview.md,
// "Hard requirements": "Render a real 3D scene on the canvas: the yard, the
// lattice aids, the crane's members and parts, the loads, and the readouts".
// specs/assets.md, "What is drawn in code": the members are "each as real drawn
// geometry".
//
// SO THE PICTURE IS THE STRUCTURE IN THE WORLD. A member runs between two
// lattice nodes (specs/structure.md), so drawing it is drawing something along
// the line joining where those two nodes are drawn — and where they are drawn is
// the build's own answer, read from `project`, which
// specs/instrumentation.md defines as "Where `(x, y, z)` is drawn, through the
// camera as it stands". A validator that projected through a camera of its own
// would be grading its own arithmetic.
//
// THE READING IS A BEFORE AND AFTER, because what a build draws a strut AS is
// entirely its own: a box beam, a tube, a pair of rails. What is fixed is that
// placing one changes the picture, and that the change lies along the segment
// and not somewhere else. So the yard is emptied to nothing, the frame is
// photographed, the one member is posed with the camera and the pointer
// untouched, and the frame is photographed again.
//
// THE FLANKS ARE THE OTHER HALF OF THE ASSERTION. A build that answered the
// first half alone could be repainting the whole yard; the two lines parallel to
// the segment, `FLANK` logical pixels to either side of it, are what says the
// change is the member and is where the member is. `FLANK` is far wider than any
// member is drawn — a strut spans two units of world, tens of pixels at this
// pose — and the member stands alone in the yard, so nothing else is expected
// there.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertGreaterThanOrEqual,
  assertLessThanOrEqual,
  assertTrue,
} from "../assert";
import { STAGE_H, STAGE_W } from "../constants";
import { createHarness, openSite, type Harness } from "../harness";

const SITE = 0;

/** The member: one vertical strut, out along `+x`, clear of the readouts. */
const FROM = { x: 8, y: 4, z: 0 } as const;
const TO = { x: 8, y: 10, z: 0 } as const;

/** How many points are read along the projected segment. */
const SAMPLES = 10;

/** How many of them a member drawn along the segment must reach. */
const NEEDED = 8;

/** How far to either side of the segment the picture must stand unchanged. */
const FLANK = 60;

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
  // One held frame first: the page is off its own paint clock (see
  // `paint-gate.js`), and a screenshot is the whole page rather than just the
  // canvas `advance` has already drawn.
  await h.paintFrame();
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

it("paints a placed member along the segment between its two nodes", async () => {
  await openSite(h, SITE);
  // The opening `reset` leaves every site's stored structure and tape empty and
  // `openSite` keeps them (specs/state.md), so only the site's own yard has to be
  // cleared.
  await h.debug.clearLoads();
  await h.debug.clearObstacles();
  await h.advance(1);

  const a = await h.project(FROM.x, FROM.y, FROM.z);
  const b = await h.project(TO.x, TO.y, TO.z);
  for (const [node, at] of [
    [FROM, a],
    [TO, b],
  ] as const) {
    assertTrue(
      at.visible,
      `the node (${node.x}, ${node.y}, ${node.z}) to be drawn on the stage at ` +
        "the start camera pose, which this point needs a picture of " +
        "(specs/instrumentation.md)",
    );
  }
  const span = Math.hypot(b.x - a.x, b.y - a.y);
  assertGreaterThanOrEqual(
    span,
    2 * FLANK,
    "the projected segment to be long enough to read along, which this " +
      "member is at the start camera pose",
  );

  // The unit normal of the segment on the stage: where the flanks are.
  const nx = -(b.y - a.y) / span;
  const ny = (b.x - a.x) / span;

  const along = Array.from({ length: SAMPLES }, (_unused, i) => {
    const t = (i + 0.5) / SAMPLES;
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  });
  const flanks = along.flatMap((point) => [
    { x: point.x + nx * FLANK, y: point.y + ny * FLANK, side: "one side" },
    {
      x: point.x - nx * FLANK,
      y: point.y - ny * FLANK,
      side: "the other side",
    },
  ]);
  for (const point of [...along, ...flanks]) {
    assertTrue(
      point.x >= 0 && point.x < STAGE_W && point.y >= 0 && point.y < STAGE_H,
      "every point this check reads to lie on the stage, which the member " +
        "and its flanks do at the start camera pose",
    );
  }

  const empty = await readFrame(h);

  await h.debug.addMember(FROM.x, FROM.y, FROM.z, TO.x, TO.y, TO.z, "strut");
  await h.advance(1);
  assertTrue(
    (await h.snapshot()).structure.members.length === 1,
    "the one member this point poses to stand (specs/structure.md)",
  );

  const built = await readFrame(h);
  await h.capture("member", "The member drawn between its two nodes");

  const painted = along.filter(
    (point) =>
      apart(empty.at(point.x, point.y), built.at(point.x, point.y)) > DREW,
  ).length;
  assertGreaterThanOrEqual(
    painted,
    NEEDED,
    `${NEEDED} of the ${SAMPLES} points sampled along the segment joining ` +
      `(${FROM.x}, ${FROM.y}, ${FROM.z}) and (${TO.x}, ${TO.y}, ${TO.z}) ` +
      "where the camera draws them to be painted when the member is placed, " +
      "since the structure is drawn as built in the yard (specs/ui.md)",
  );

  const spilled = flanks
    .map((point) => ({
      point,
      gap: apart(empty.at(point.x, point.y), built.at(point.x, point.y)),
    }))
    .filter(({ gap }) => gap > UNCHANGED);
  assertLessThanOrEqual(
    spilled.length,
    0,
    `the stage ${FLANK} logical pixels to either side of the projected ` +
      "segment to stand unchanged, since a member is drawn along the segment " +
      "between its nodes and nowhere else (specs/ui.md); it changed at " +
      `${spilled.map(({ point }) => `(${point.x.toFixed(0)}, ${point.y.toFixed(0)}) on ${point.side}`).join(", ")}`,
  );
});
