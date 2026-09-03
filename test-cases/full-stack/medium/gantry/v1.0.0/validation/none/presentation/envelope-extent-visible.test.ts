// presentation/envelope-extent-visible — the build screen draws the envelope's
// extent as a visible aid, at the site's own ranges.
//
// specs/overview.md, "Visual design": "On the build screen, the buildable lattice
// and the envelope's extent are visible aids". specs/world.md, "The envelope":
// "Each site fixes a build envelope: an axis-aligned box, stated as inclusive
// coordinate ranges on each axis. Every lattice node used by the structure lies
// inside the envelope, so the envelope bounds where the crane may be built."
// specs/sites.md fixes those ranges site by site.
//
// TWO SITES, BECAUSE THE AID IS THE SITE'S RANGES AND NOT A DECORATION. Site
// three, Over the Wall, runs `x -10..12`; site four, Long Reach, runs `x -10..20`.
// So the same world position — the vertical line where `x = 12` meets `z = -8` —
// is the envelope's own corner on one site and ordinary space well inside it on
// the other. A build that drew a fixed box, or drew none at all, cannot answer
// both frames: the boundary has to be at `x = 12` on the first site and at
// `x = 20` on the second, and gone from `x = 12` there.
//
// THE POINTS ARE READ AT ODD HEIGHTS, which is the whole reason this reads a
// vertical corner and not the ground line. `LATTICE_PITCH` is `2`
// (specs/world.md), so a lattice node's coordinates are all even and a point at
// `y = 5` is on the envelope's corner and on no node — which keeps the lattice
// aid, the other half of the same sentence, out of the reading. Each point is
// read against a control four units INSIDE the same face at the same height,
// which is the same kind of place with no boundary through it.
//
// THE YARD IS EMPTIED on both sites and the pointer parked off every node, so
// nothing is built against the boundary, no obstacle or load stands near it, and
// no node is highlighted. The camera is left where opening a site puts it, so the
// two frames are the same view of two different envelopes.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertGreaterThanOrEqual,
  assertLessThanOrEqual,
  assertTrue,
} from "../assert";
import { STAGE_H, STAGE_W } from "../constants";
import { clearAll, createHarness, openSite, type Harness } from "../harness";

/** Site three, `x -10..12`, and site four, `x -10..20` (specs/sites.md). */
const NEAR_SITE = 2;
const FAR_SITE = 3;

/** Where each site's envelope ends along `+x`. */
const NEAR_EDGE = 12;
const FAR_EDGE = 20;

/** The face both corners stand on: `z = -8`, shared by both envelopes. */
const FACE_Z = -8;

/** The heights read, all odd, so no lattice node lies on any of them. */
const HEIGHTS = [5, 7, 9, 11, 13, 15] as const;

/** How far inside the same face the control for each point stands. */
const INSIDE = 4;

/** How many of the six must carry the boundary on the site that has one. */
const NEEDED = 5;

/** How many may carry it on the site whose envelope reaches past it. */
const ALLOWED = 1;

/** How far around a point the boundary is looked for, in logical pixels. */
const REACH = 3;

/** A colour difference that is a thing being drawn, out of 441. */
const DREW = 50;

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
/** The heights at which the corner at `x` carries something its inside does not. */
async function boundaryAt(
  h: Harness,
  frame: Frame,
  x: number,
): Promise<number[]> {
  const carrying: number[] = [];
  for (const y of HEIGHTS) {
    const on = await h.project(x, y, FACE_Z);
    const inside = await h.project(x - INSIDE, y, FACE_Z);
    assertTrue(
      on.visible && inside.visible,
      `(${x}, ${y}, ${FACE_Z}) and its control ${INSIDE} units inside to be ` +
        "drawn on the stage at the start camera pose, which this point needs " +
        "a picture of (specs/instrumentation.md)",
    );
    const bare = frame.at(inside.x, inside.y);
    let strongest = 0;
    for (let dy = -REACH; dy <= REACH; dy += 1) {
      for (let dx = -REACH; dx <= REACH; dx += 1) {
        if (dx * dx + dy * dy > REACH * REACH) continue;
        strongest = Math.max(
          strongest,
          apart(frame.at(on.x + dx, on.y + dy), bare),
        );
      }
    }
    if (strongest > DREW) carrying.push(y);
  }
  return carrying;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws the envelope's boundary where the open site's ranges put it", async () => {
  await openSite(h, NEAR_SITE);
  await clearAll(h);
  await h.pointerMove(PARKED.x, PARKED.y);
  await h.advance(1);

  const near = await h.snapshot();
  assertTrue(
    near.site.envelope.max.x === NEAR_EDGE,
    `site ${NEAR_SITE + 1} to run out to x ${NEAR_EDGE} (specs/sites.md)`,
  );
  const nearFrame = await readFrame(h);
  await h.capture("envelope", "The envelope aid on two sites");

  const nearOwn = await boundaryAt(h, nearFrame, NEAR_EDGE);
  const nearFar = await boundaryAt(h, nearFrame, FAR_EDGE);

  await openSite(h, FAR_SITE);
  await clearAll(h);
  await h.pointerMove(PARKED.x, PARKED.y);
  await h.advance(1);

  const far = await h.snapshot();
  assertTrue(
    far.site.envelope.max.x === FAR_EDGE,
    `site ${FAR_SITE + 1} to run out to x ${FAR_EDGE} (specs/sites.md)`,
  );
  const farFrame = await readFrame(h);

  const farOwn = await boundaryAt(h, farFrame, FAR_EDGE);
  const farNear = await boundaryAt(h, farFrame, NEAR_EDGE);

  assertGreaterThanOrEqual(
    nearOwn.length,
    NEEDED,
    `${NEEDED} of the ${HEIGHTS.length} heights on the corner where ` +
      `x = ${NEAR_EDGE} meets z = ${FACE_Z} to carry something the same face ` +
      `${INSIDE} units inside does not, on the site whose envelope ends there, ` +
      "since the build screen draws the envelope's extent as a visible aid " +
      `(specs/overview.md); only ${nearOwn.length} did`,
  );
  assertGreaterThanOrEqual(
    farOwn.length,
    NEEDED,
    `${NEEDED} of the ${HEIGHTS.length} heights on the corner where ` +
      `x = ${FAR_EDGE} meets z = ${FACE_Z} to carry it on the site whose ` +
      `envelope ends there (specs/overview.md); only ${farOwn.length} did`,
  );
  assertLessThanOrEqual(
    nearFar.length,
    ALLOWED,
    `nothing at x = ${FAR_EDGE} on the site whose envelope stops at ` +
      `${NEAR_EDGE}, since the aid is drawn at the site's own ranges ` +
      `(specs/world.md); ${nearFar.length} of the ${HEIGHTS.length} heights ` +
      `carried a boundary there (y ${nearFar.join(", ")})`,
  );
  assertLessThanOrEqual(
    farNear.length,
    ALLOWED,
    `nothing at x = ${NEAR_EDGE} any more on the site whose envelope reaches ` +
      `${FAR_EDGE}, since the aid follows the site's ranges (specs/world.md); ` +
      `${farNear.length} of the ${HEIGHTS.length} heights still carried a ` +
      `boundary there (y ${farNear.join(", ")})`,
  );
});
