// presentation/picked-node-highlighted — the node a click would take is
// highlighted before the click.
//
// specs/overview.md, "Visual design": "On the build screen, the buildable lattice
// and the envelope's extent are visible aids, and the picked node under the
// pointer is highlighted." specs/controls.md says the same from the other side:
// a node pick "considers every lattice node in the envelope that stands in front
// of the camera, projected to the stage; the candidate is the nearest at most
// `NODE_PICK_PX` (`20`) logical pixels from the click... The candidate under the
// pointer is highlighted before the click, so the player sees what a click would
// take."
//
// SO THE HIGHLIGHT IS A DIFFERENCE THE POINTER MAKES. What the build draws it AS
// is entirely its own — a ring, a brighter mark, a cage — so the reading is the
// same node's neighbourhood with the pointer on it and with the pointer away
// from every node: what parted between those two frames is the highlight, and it
// has to be where the node the snapshot reports as `pick.node` is drawn.
//
// THE NODE READ IS THE ONE THE BUILD ITSELF PICKED. The pointer is put on a
// chosen node's projected point, and then `pick.node` says which node a click
// would take there; that node's own projected point is where the highlight is
// looked for. A validator that insisted on its own answer to the pick would be
// grading `specs/controls.md`'s tie-breaking, which is another point's.
//
// THE CONTROL IS A SECOND LATTICE NODE far from the pointer in both frames. It
// says the highlight is one node's and not a change over the whole lattice: a
// build that lit every node when the pointer entered the yard would answer the
// first half and fail here.
//
// THE YARD IS EMPTIED, on a site opened fresh — nothing built, no loads, no
// obstacles — so the only thing that can change under the pointer is the aid this
// point is about.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertGreaterThan,
  assertLessThanOrEqual,
  assertNotNull,
  assertNull,
  assertTrue,
} from "../assert";
import { NODE_PICK_PX, STAGE_H, STAGE_W } from "../constants";
import {
  createHarness,
  emptyYard,
  openSite,
  type Harness,
  type Vec3,
} from "../harness";

const SITE = 0;

/** The node the pointer is put on: on the ground, off the anchors, in the clear. */
const AIMED: Vec3 = { x: 6, y: 0, z: -4 };

/** The node that must not change: another ground node, far from the pointer. */
const CONTROL: Vec3 = { x: -4, y: 0, z: 4 };

/** Where the pointer goes when it is off every node: a stage corner. */
const PARKED = { x: STAGE_W - 4, y: STAGE_H - 4 } as const;

/** How far around a node's projected point the highlight is looked for. */
const REACH = 6;

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
/** The furthest two frames stand apart within `REACH` of a stage point. */
function parted(a: Frame, b: Frame, x: number, y: number): number {
  let widest = 0;
  for (let dy = -REACH; dy <= REACH; dy += 1) {
    for (let dx = -REACH; dx <= REACH; dx += 1) {
      if (dx * dx + dy * dy > REACH * REACH) continue;
      widest = Math.max(
        widest,
        apart(a.at(x + dx, y + dy), b.at(x + dx, y + dy)),
      );
    }
  }
  return widest;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("highlights the node under the pointer and leaves the rest of the lattice alone", async () => {
  await openSite(h, SITE);
  await emptyYard(h);

  const aimed = await h.project(AIMED.x, AIMED.y, AIMED.z);
  const control = await h.project(CONTROL.x, CONTROL.y, CONTROL.z);
  assertTrue(
    aimed.visible && control.visible,
    `the nodes (${AIMED.x}, ${AIMED.y}, ${AIMED.z}) and (${CONTROL.x}, ` +
      `${CONTROL.y}, ${CONTROL.z}) to be drawn on the stage at the start ` +
      "camera pose (specs/instrumentation.md)",
  );
  assertGreaterThan(
    Math.hypot(control.x - aimed.x, control.y - aimed.y),
    2 * NODE_PICK_PX,
    "the control node to stand further than the pick radius from the aimed " +
      "one, so the pointer is never picking it (specs/controls.md)",
  );

  await h.pointerMove(aimed.x, aimed.y);
  await h.advance(1);
  const over = await h.snapshot();
  assertNotNull(
    over.pick.node,
    `a node picked with the pointer on (${AIMED.x}, ${AIMED.y}, ${AIMED.z})'s ` +
      `projected point, which is within NODE_PICK_PX (${NODE_PICK_PX}) of it ` +
      "(specs/controls.md)",
  );
  const picked = over.pick.node as Vec3;
  const highlighted = await h.project(picked.x, picked.y, picked.z);
  const onNode = await readFrame(h);
  await h.capture("pick", "The picked node highlighted under the pointer");

  await h.pointerMove(PARKED.x, PARKED.y);
  await h.advance(1);
  const away = await h.snapshot();
  assertNull(
    away.pick.node,
    "no node picked with the pointer parked in a stage corner, which is what " +
      "makes the second frame the same yard with nothing highlighted " +
      "(specs/controls.md)",
  );
  const offNode = await readFrame(h);

  assertGreaterThan(
    parted(onNode, offNode, highlighted.x, highlighted.y),
    DREW,
    `the picture within ${REACH} logical pixels of (${picked.x}, ${picked.y}, ` +
      `${picked.z}) — the node the snapshot reports a click would take — to ` +
      "change when the pointer leaves it, since the picked node under the " +
      "pointer is highlighted (specs/overview.md)",
  );
  assertLessThanOrEqual(
    parted(onNode, offNode, control.x, control.y),
    UNCHANGED,
    `the picture around the lattice node (${CONTROL.x}, ${CONTROL.y}, ` +
      `${CONTROL.z}), which no pointer was ever near, to stand unchanged: it ` +
      "is the PICKED node that is highlighted (specs/overview.md)",
  );
});
