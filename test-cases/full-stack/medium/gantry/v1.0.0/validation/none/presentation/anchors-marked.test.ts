// presentation/anchors-marked — a site's anchor nodes are marked in the yard,
// distinctly from the ordinary lattice around them.
//
// specs/overview.md, "Visual design", the row for anchors and pads: "Anchor
// points, each load's starting position, and each pad's footprint and required
// yaw are marked so a site is readable before anything is built."
// specs/world.md, "Anchors": each site fixes "lattice nodes on the ground where
// the structure is fixed to the earth", and specs/ui.md's `build` screen "shows
// the yard through the camera: the ground, the lattice and envelope aids, the
// anchors, ...".
//
// SO AN ANCHOR IS NOT JUST ANOTHER LATTICE NODE ON SCREEN. An anchor IS a lattice
// node, so a build that only drew the lattice would put the same mark on it as on
// the node beside it and the player could not read where the crane is fixed to
// the earth before building. The reading is therefore an anchor against an
// ordinary ground lattice node inside the same envelope: what the site says is
// different has to look different.
//
// WHAT IS MEASURED IS PAINTED AREA, NOT HUE. specs/overview.md leaves the palette
// to the build, so nothing here compares a reading against a colour; what it
// compares is how much of the neighbourhood around a node the build painted with
// something other than the bare yard floor. A mark a player reads at a glance
// covers ground; the lattice's own mark on an ordinary node barely does. The bare
// floor is read at the middle of a cell — a ground position that is not a lattice
// node, so nothing is drawn on it — beside the ordinary node.
//
// SITE SIX IS THE ONE READ, because its nine anchors over `(0..4, 0, 0..4)`
// (specs/sites.md) are the largest set the game has, so the point is decided over
// nine independent marks rather than four. `(10, 0, 0)` is the ordinary node they
// are read against: inside site six's envelope (`x -10..18`), on the ground, on
// the lattice, and not an anchor.
//
// THE YARD IS EMPTIED and the pointer parked off every node, so nothing is built
// over the anchors, no load or obstacle stands on one, and no node is highlighted.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThanOrEqual, assertNull, assertTrue } from "../assert";
import { STAGE_H, STAGE_W } from "../constants";
import {
  clearAll,
  createHarness,
  openSite,
  type Harness,
  type Vec3,
} from "../harness";

/** Site six, Heavy Haul, whose nine anchors run over `(0..4, 0, 0..4)`. */
const SITE = 5;

/** The ordinary ground lattice node the anchors are read against. */
const PLAIN: Vec3 = { x: 10, y: 0, z: 0 };

/** How many of the nine must read apart from it. */
const NEEDED = 8;

/** The radius of the neighbourhood a node's mark is read over, in pixels. */
const REACH = 8;

/** A colour difference that is something drawn over the floor, out of 441. */
const DREW = 50;

/**
 * How much more of its neighbourhood an anchor's mark must cover than the
 * ordinary lattice node's, as a share of that neighbourhood.
 *
 * Not a figure the specification states: it is what "marked, and readable at a
 * glance" is worth in area. A fifth of the neighbourhood is several times the
 * few pixels a lattice mark puts on an ordinary node and well under what any
 * fixture drawn on an anchor covers.
 */
const MARGIN = 0.2;

/** Where the pointer is parked: a stage corner, so no node is picked. */
const PARKED = { x: STAGE_W - 4, y: STAGE_H - 4 } as const;

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
/** The share of the neighbourhood of a stage point painted other than `bare`. */
function covered(frame: Frame, x: number, y: number, bare: Rgb): number {
  let painted = 0;
  let total = 0;
  for (let dy = -REACH; dy <= REACH; dy += 1) {
    for (let dx = -REACH; dx <= REACH; dx += 1) {
      if (dx * dx + dy * dy > REACH * REACH) continue;
      total += 1;
      if (apart(frame.at(x + dx, y + dy), bare) > DREW) painted += 1;
    }
  }
  return painted / total;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("marks every anchor apart from the ordinary lattice around it", async () => {
  await openSite(h, SITE);
  await clearAll(h);
  await h.pointerMove(PARKED.x, PARKED.y);
  await h.advance(1);

  const posed = await h.snapshot();
  assertNull(
    posed.pick.node,
    "no node picked under the parked pointer, so nothing read here is the " +
      "picked node's highlight (specs/controls.md)",
  );
  const anchors = posed.site.anchors;
  assertGreaterThanOrEqual(
    anchors.length,
    9,
    `the nine anchors specs/sites.md gives ${posed.site.name}`,
  );

  const plain = await h.project(PLAIN.x, PLAIN.y, PLAIN.z);
  // The middle of the cell beside it: a ground position that is not a lattice
  // node, so what is drawn there is the bare yard floor. One step along `+x` and
  // one back along `-z`, which at this camera pose lands to the SIDE of the node
  // on the stage rather than behind it.
  const floor = await h.project(PLAIN.x + 1, PLAIN.y, PLAIN.z - 1);
  assertTrue(
    plain.visible && floor.visible,
    `the ordinary node (${PLAIN.x}, ${PLAIN.y}, ${PLAIN.z}) and the bare ` +
      "floor beside it to be drawn on the stage at the start camera pose " +
      "(specs/instrumentation.md)",
  );

  const frame = await readFrame(h);
  await h.capture("anchors", "The nine anchors marked in the yard");

  const bare = frame.at(floor.x, floor.y);
  const ordinary = covered(frame, plain.x, plain.y, bare);
  const unmarked: string[] = [];
  for (const anchor of anchors) {
    const at = await h.project(anchor.x, anchor.y, anchor.z);
    assertTrue(
      at.visible,
      `the anchor (${anchor.x}, ${anchor.y}, ${anchor.z}) to be drawn on the ` +
        "stage at the start camera pose (specs/instrumentation.md)",
    );
    const marked = covered(frame, at.x, at.y, bare);
    if (marked - ordinary <= MARGIN) {
      unmarked.push(
        `(${anchor.x}, ${anchor.y}, ${anchor.z}) at ${marked.toFixed(2)}`,
      );
    }
  }

  assertGreaterThanOrEqual(
    anchors.length - unmarked.length,
    NEEDED,
    `${NEEDED} of the ${anchors.length} anchors to carry a mark covering at ` +
      `least ${MARGIN} more of its neighbourhood than the ordinary ground ` +
      `lattice node (${PLAIN.x}, ${PLAIN.y}, ${PLAIN.z}) does ` +
      `(${ordinary.toFixed(2)}), since anchor points are marked so a site is ` +
      "readable before anything is built (specs/overview.md); nothing set " +
      `apart ${unmarked.join(", ")}`,
  );
});
