// presentation/lattice-aids-visible — the build screen draws the buildable
// lattice as a visible aid.
//
// specs/overview.md, "Visual design", the row for the lattice: "On the build
// screen, the buildable lattice and the envelope's extent are visible aids, and
// the picked node under the pointer is highlighted." specs/ui.md, "Build":
// `build` "shows the yard through the camera: the ground, the lattice and
// envelope aids, the anchors, the obstacles, the loads at their starting poses,
// the pads, and the structure as built". The lattice itself is
// specs/world.md's: "the points whose coordinates are all integer multiples of
// `LATTICE_PITCH` (`2`)", bounded by the site's envelope.
//
// WHAT AN AID BEING VISIBLE MEANS HERE. The player has to read where a member
// may start and end before clicking, so the picture has to carry something at a
// lattice node that it does not carry between nodes. That is the reading: a node
// against the middle of a cell beside it — a position with no lattice node on it
// and nothing else in the yard, which is where a build that drew no lattice
// would look exactly the same as at the node.
//
// THE CELL MIDDLE IS TAKEN ONE STEP ALONG `+x` AND ONE BACK ALONG `-z`, which is
// the middle of the cell next door and, at the start camera pose, lies a good
// twenty pixels to the SIDE of the node on the stage rather than behind it. The
// obvious `(x + 1, 0, z + 1)` is the wrong control at this pose: yaw `45` looks
// straight down that diagonal, so it projects almost on top of the node itself.
//
// THE NODE IS READ AS A NEIGHBOURHOOD rather than as one pixel. How big a build
// draws its lattice marks is its own, and a mark a couple of pixels across on an
// anti-aliased edge is easy to miss by a pixel, so what is compared against the
// cell middle is the furthest-from-it colour within `REACH` of the node's
// projected point — a radius far smaller than the ten to twenty pixels that
// separate two projected nodes at this pose, so a mark found there belongs to
// this node.
//
// THE YARD IS EMPTIED and the pointer is parked off every node: nothing is built,
// no loads, no obstacles, and no node is picked, so the only thing that can be
// standing at a lattice node is the aid. The nodes are all on the ground, well
// inside the envelope, clear of the site's anchors and clear of the readouts.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThanOrEqual, assertNull, assertTrue } from "../assert";
import { STAGE_H, STAGE_W } from "../constants";
import {
  createHarness,
  emptyYard,
  openSite,
  runTicks,
  type Harness,
  type Vec3,
} from "../harness";

const SITE = 0;

/**
 * Six ground lattice nodes: inside site 1's envelope (`x -8..12`, `z -8..12`),
 * off its four anchors at `(0..2, 0, 0..2)`, off its envelope's own boundary,
 * and drawn clear of the readouts down the left of the build screen.
 */
const NODES: readonly Vec3[] = [
  { x: 4, y: 0, z: -4 },
  { x: 6, y: 0, z: -4 },
  { x: 8, y: 0, z: -2 },
  { x: 4, y: 0, z: 4 },
  { x: 6, y: 0, z: 6 },
  { x: 8, y: 0, z: 4 },
];

/** How many of the six must carry a mark for the aid to be visible. */
const NEEDED = 5;

/** How far around a node's projected point its mark is looked for, in pixels. */
const REACH = 5;

/** Where the pointer is parked: a stage corner, so no node is picked. */
const PARKED = { x: STAGE_W - 4, y: STAGE_H - 4 } as const;

/** A colour difference that is a thing being drawn, out of 441. */
const DREW = 50;

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

it("marks the buildable lattice nodes on the build screen", async () => {
  await openSite(h, SITE);
  // The YARD AND THE STRUCTURE, rather than the whole world: a site opens with an
  // empty tape (`specs/state.md`) and nothing here poses one, so the tape needs no
  // clearing and the program screen is never visited.
  await emptyYard(h);
  await h.debug.clearStructure();
  await h.pointerMove(PARKED.x, PARKED.y);
  // The frame and the reading in one crossing: `runTicks` answers with the state
  // the ticks it drove left (`validation/harness.ts`).
  const posed = await runTicks(h, 1);
  assertTrue(
    posed.screen === "build",
    "the build screen, which is where the lattice is an aid (specs/ui.md)",
  );
  assertNull(
    posed.pick.node,
    "no node picked under the parked pointer, so nothing here is the picked " +
      "node's highlight rather than the lattice aid (specs/controls.md)",
  );

  const frame = await readFrame(h);
  await h.capture("lattice", "The lattice aid on the empty build screen");

  const missing: string[] = [];
  for (const node of NODES) {
    const at = await h.project(node.x, node.y, node.z);
    const cell = await h.project(node.x + 1, node.y, node.z - 1);
    assertTrue(
      at.visible && cell.visible,
      `the node (${node.x}, ${node.y}, ${node.z}) and the middle of the cell ` +
        "beside it to be drawn on the stage at the start camera pose " +
        "(specs/instrumentation.md)",
    );

    const bare = frame.at(cell.x, cell.y);
    let strongest = 0;
    for (let dy = -REACH; dy <= REACH; dy += 1) {
      for (let dx = -REACH; dx <= REACH; dx += 1) {
        if (dx * dx + dy * dy > REACH * REACH) continue;
        strongest = Math.max(
          strongest,
          apart(frame.at(at.x + dx, at.y + dy), bare),
        );
      }
    }
    if (strongest <= DREW) {
      missing.push(
        `(${node.x}, ${node.y}, ${node.z}) at ${strongest.toFixed(0)}`,
      );
    }
  }

  assertGreaterThanOrEqual(
    NODES.length - missing.length,
    NEEDED,
    `${NEEDED} of the ${NODES.length} lattice nodes read to carry a mark the ` +
      "middle of the cell beside them does not, since the build screen draws " +
      "the buildable lattice as a visible aid (specs/overview.md); nothing " +
      `stood at ${missing.join(", ")}`,
  );
});
