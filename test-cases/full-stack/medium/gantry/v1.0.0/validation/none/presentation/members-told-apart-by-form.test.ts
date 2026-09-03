// presentation/members-told-apart-by-form — a strut, a cable and a rail are told
// apart by form and not by hue alone.
//
// specs/overview.md, "Visual design", the row for members by material: "A strut,
// a cable, and a rail are told apart at a glance, by form and not by hue alone."
// specs/assets.md, "What is drawn in code": the members are "each as real drawn
// geometry telling strut, cable, and rail apart".
//
// HUE IS DISCARDED BY CONSTRUCTION. What this point reads is not colour but the
// SHAPE each material paints: the set of stage points that changed when the
// member was placed. Two materials drawn as the same geometry in two colours
// paint the same set and fail here; two drawn as different geometry paint
// different sets and pass whatever colours they are drawn in. So the reading
// answers the sentence's own question — told apart by form, not by hue.
//
// THE THREE STAND BETWEEN THE SAME TWO NODES, one at a time, with the camera and
// the pointer untouched and the yard emptied around them, so the only thing that
// can differ between the three masks is how the material itself is drawn. The
// nodes are chosen horizontal because specs/structure.md refuses a rail that is
// not ("it is a rail member and is not horizontal"), and six units apart because
// that is `STRUT_MAX_LEN` and `RAIL_MAX_LEN`, the longest all three accept.
//
// THE MASKS ARE COMPARED BY OVERLAP. Two shapes that are the same cover each
// other; two that differ do not, and the share of their union their intersection
// covers is how much of the pair is common. Anything below `SHARED` is two
// materials a player can tell apart at a glance without reading their colour —
// a shape that is thicker, or carries a head, or is a line where the other is a
// beam.

import { afterEach, beforeEach, it } from "vitest";
import { assertLessThan, assertTrue } from "../assert";
import { STAGE_H, STAGE_W } from "../constants";
import {
  clearAll,
  createHarness,
  openSite,
  type Harness,
  type MaterialName,
} from "../harness";

const SITE = 0;

/** The two nodes all three materials stand between: horizontal, six units. */
const FROM = { x: 6, y: 6, z: 0 } as const;
const TO = { x: 12, y: 6, z: 0 } as const;

/** The three materials specs/structure.md gives. */
const MATERIALS: readonly MaterialName[] = ["strut", "cable", "rail"];

/** How far around the projected segment a mask is taken, in logical pixels. */
const MARGIN = 30;

/** A change in the picture that is a thing being drawn, out of 441. */
const DREW = 50;

/**
 * The most of a pair's union its intersection may cover.
 *
 * Not a figure the specification states: it is what "told apart at a glance"
 * is worth as overlap. Two shapes covering four fifths of each other are the
 * same shape with a rim of difference — a hue change and a pixel of stroke —
 * and a player reading the yard at speed would not separate them; anything a
 * material genuinely draws differently, a thinner line, a head, a second rail,
 * parts from the other by far more than a fifth of the pair.
 */
const SHARED = 0.8;

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
let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws the three materials as three different shapes", async () => {
  await openSite(h, SITE);
  await clearAll(h);
  await h.pointerMove(PARKED.x, PARKED.y);
  await h.advance(1);

  const a = await h.project(FROM.x, FROM.y, FROM.z);
  const b = await h.project(TO.x, TO.y, TO.z);
  assertTrue(
    a.visible && b.visible,
    `the nodes (${FROM.x}, ${FROM.y}, ${FROM.z}) and (${TO.x}, ${TO.y}, ` +
      `${TO.z}) to be drawn on the stage at the start camera pose ` +
      "(specs/instrumentation.md)",
  );

  // Every stage point a member between those two nodes could paint: the
  // projected segment's own box, opened out by a margin for whatever thickness,
  // head or halo the build gives it.
  const left = Math.max(0, Math.floor(Math.min(a.x, b.x) - MARGIN));
  const right = Math.min(STAGE_W - 1, Math.ceil(Math.max(a.x, b.x) + MARGIN));
  const top = Math.max(0, Math.floor(Math.min(a.y, b.y) - MARGIN));
  const bottom = Math.min(STAGE_H - 1, Math.ceil(Math.max(a.y, b.y) + MARGIN));
  assertTrue(
    right - left > 2 * MARGIN && bottom - top > 0,
    "the projected segment to lie inside the stage with room around it, " +
      "which it does at the start camera pose",
  );

  const empty = await readFrame(h);

  const masks = new Map<MaterialName, boolean[]>();
  for (const material of MATERIALS) {
    await h.debug.clearStructure();
    await h.debug.addMember(FROM.x, FROM.y, FROM.z, TO.x, TO.y, TO.z, material);
    await h.advance(1);
    const structure = (await h.snapshot()).structure;
    assertTrue(
      structure.members.length === 1 &&
        structure.members[0]!.material === material,
      `the one ${material} this point poses to stand between ` +
        `(${FROM.x}, ${FROM.y}, ${FROM.z}) and (${TO.x}, ${TO.y}, ${TO.z}) ` +
        "(specs/structure.md)",
    );

    const drawn = await readFrame(h);
    if (material === "rail") {
      await h.capture(
        "materials",
        "A strut, a cable and a rail between the same nodes",
      );
    }

    const mask: boolean[] = [];
    let painted = 0;
    for (let y = top; y <= bottom; y += 1) {
      for (let x = left; x <= right; x += 1) {
        const on = apart(empty.at(x, y), drawn.at(x, y)) > DREW;
        mask.push(on);
        if (on) painted += 1;
      }
    }
    assertTrue(
      painted > 0,
      `the ${material} to paint something between its two nodes, which is ` +
        "what a member drawn as real geometry does (specs/assets.md)",
    );
    masks.set(material, mask);
  }

  for (let i = 0; i < MATERIALS.length; i += 1) {
    for (let j = i + 1; j < MATERIALS.length; j += 1) {
      const one = masks.get(MATERIALS[i]!)!;
      const two = masks.get(MATERIALS[j]!)!;
      let both = 0;
      let either = 0;
      for (let k = 0; k < one.length; k += 1) {
        if (one[k]! && two[k]!) both += 1;
        if (one[k]! || two[k]!) either += 1;
      }
      assertLessThan(
        both / either,
        SHARED,
        `the ${MATERIALS[i]} and the ${MATERIALS[j]} to be drawn as ` +
          "different shapes between the same two nodes, since the three " +
          "materials are told apart by form and not by hue alone " +
          "(specs/overview.md)",
      );
    }
  }
});
