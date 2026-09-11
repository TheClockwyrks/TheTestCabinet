// hud/hud-clear-of-field — every HUD readout is drawn clear of the containment
// field.
//
// specs/screens.md: "The HUD is drawn on `playing`, clear of the containment
// field, so nothing it draws crosses the field of play", and the field is "the
// circle of radius `480`" around the stage center (specs/field.md). So nothing
// the HUD draws may cross that circle. WHERE ON THE STAGE THE HUD SITS is the
// build's — "Where on the stage it sits is yours" — so nothing here reads it.
//
// WHICH MARKS ARE THE HUD'S is the whole difficulty, and it is decided the way
// the rest of this directory decides a readout (`readouts.ts`): differentially.
// The HUD reports "Score ... Lives ... Wave ... Effects", so a mark that draws
// one of those figures is a mark that CHANGES when the figure does. Two poses
// of the same isolated field, differing only in the score, the lives, the wave
// and whether pierce is in force, are read; a mark present in one pose and not
// the other is a readout, and every readout must clear the circle.
//
// READ THE SAME THREE WAYS `readouts.ts` READS A FRAME: the text runs and the
// sprite blits with their device anchors, AND a stride-4 grid of the rendered
// pixels. The first two attribute a readout to the call that placed it and so
// carry the box it covers; the third carries only a point, which is all the
// clearance test needs, and it is what makes the reading ROUTE-INDEPENDENT.
// specs/screens.md fixes "no palette, no font, and no layout for its screens",
// and of the HUD only that "Where on the stage it sits is yours" and, of the
// effects readout, that "how it looks is yours" — it fixes no drawing ROUTE at
// all. A build is free to compose its HUD on a scratch canvas and blit the
// result in one call, which is the faculty this case's harnesses install
// (`installAssetHost`'s `documentElement`); a HUD drawn that way places no
// attributable readout at all, and on the calls alone there would be nothing
// here to judge it by — neither to clear it nor to fault it.
//
// WHY NOT "EVERY TEXT RUN ON THE PLAYING FRAME", WHICH IS WHAT THIS WAS. That
// rested on the playing screen carrying no text but the HUD's. A build is free
// to letter its own field — a legend under the planet, a name on the shield
// ring — and such a run is not a readout and is not what the sentence above is
// about, yet it sat inside the circle and failed the item. A run that does not
// move with any figure the HUD reports is now simply not read here.
//
// WHAT THAT COSTS, STATED PLAINLY. A mark that is the SAME in both poses is
// invisible here whatever drew it: a standing caption beside a figure, an
// effects icon posed the same way twice, a filled backing bar behind the
// readouts. The bar is the widest of those and it is not hypothetical: a build
// that lays a full-width strip across the top of the stage and letters its
// readouts on it is judged on the readouts alone, and the strip crossing the
// circle is not read at all. Nothing here can tell that strip from the field's
// own dressing, which is the same fact the paragraph above turns on; the
// drawn-ness items police that the readouts exist at all, and this item
// decides the clearance of every mark that moves with a figure.
//
// SO THE FLOOR IS READ OVER EVERYTHING THE ITEM CAN SEE, marks and pixels
// together. It asserts only what the paragraph above admits — that SOMETHING
// on the frame moved with the posed figures — and never fails a build for the
// blindness the same paragraph owns up to.
//
// PIERCE IS THE EFFECT POSED, for the reason `hud/effects-indicated` gives:
// widen changes the deflector's span and the shield draws a ring at radius
// 100, both of them marks in the world rather than in the HUD, while pierce
// dresses only the balls and the isolated field holds none. Both are posed and
// held EQUAL across the two poses, so the full HUD is on screen for the
// captured still and neither one's world dressing can read as a readout.

import { afterEach, beforeEach, it } from "vitest";
import { assertTrue, fail } from "../assert";
import {
  FIELD_RADIUS,
  PIERCE_DURATION_TICKS,
  STAGE_CX,
  STAGE_CY,
  WIDEN_DURATION_TICKS,
} from "../constants";
import {
  captureStill,
  isolate,
  openHarness,
  textDraws,
  type Harness,
} from "../harness";
import {
  MIN_EVIDENCE_DELTA,
  PIXEL_STRIDE,
  channelDelta,
  readPixelGrid,
} from "./readouts";

/** One mark a frame placed: what it was, and the box it covered. */
interface Mark {
  what: string;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

/** One frame, read every way this item can attribute a mark to a figure. */
interface Frame {
  /** Each placed mark — text run or blit — keyed by what and where. */
  marks: Map<string, Mark>;
  /** The stride-4 grid of the frame's pixels, packed 0xRRGGBB. */
  pixels: number[];
  /** Grid columns, so an index maps back to its device point. */
  columns: number;
}

/** The two sets of figures the poses differ in. */
const POSES = [
  { score: 12345, lives: 3, wave: 2, pierce: PIERCE_DURATION_TICKS },
  { score: 98760, lives: 1, wave: 7, pierce: 0 },
] as const;

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(() => {
  h?.dispose();
});

it("keeps every HUD readout off the field of play", async () => {
  isolate(h);

  // Two frames per pose. The second is what says a mark is STILL — a mark that
  // moves or changes between two frames of one pose is the build's own
  // animation, and an animated mark differs across the poses for a reason that
  // is not the figure.
  const [first] = POSES;
  const posed: { marks: Map<string, Mark>; frames: [Frame, Frame] }[] = [];
  for (const pose of POSES) {
    const frames: Frame[] = [];
    for (let take = 0; take < 2; take += 1) {
      // Re-posed before EVERY read, so a readout that counts a timed effect
      // down draws the same figure on both frames of its own pose.
      apply(pose);
      frames.push(await readFrame(h));
      if (pose === first && take === 0) captureStill(h, "hud");
    }
    const [one, two] = frames as [Frame, Frame];
    posed.push({ marks: stillMarks(one.marks, two.marks), frames: [one, two] });
  }

  const [a, b] = posed as [(typeof posed)[number], (typeof posed)[number]];
  const readouts = new Map<string, Mark>();
  for (const [key, mark] of a.marks)
    if (!b.marks.has(key)) readouts.set(key, mark);
  for (const [key, mark] of b.marks)
    if (!a.marks.has(key)) readouts.set(key, mark);
  const points = readoutPoints(a.frames, b.frames);

  assertTrue(
    readouts.size + points.length > 0,
    "a HUD mark that changed with the posed score, lives, wave and pierce",
  );

  const view = h.viewport();
  const center = h.device(STAGE_CX, STAGE_CY);
  const fieldRadius = FIELD_RADIUS * view.scale;
  for (const mark of readouts.values()) {
    assertOffField(center, fieldRadius, mark);
  }
  for (const point of points) {
    assertOffField(center, fieldRadius, point);
  }
});

/** Put one pose's figures in force. Widen and the shield are held in both. */
function apply(pose: (typeof POSES)[number]): void {
  h.debug.setScore(pose.score);
  h.debug.setLives(pose.lives);
  h.debug.setWave(pose.wave);
  h.debug.setEffectTicks("widen", WIDEN_DURATION_TICKS);
  h.debug.setEffectTicks("pierce", pose.pierce);
  h.debug.setShield(true);
}

/** Every text run, blit and pixel one frame placed. */
async function readFrame(h: Harness): Promise<Frame> {
  const { calls, blits } = await h.frameDraw();
  const marks = new Map<string, Mark>();
  for (const draw of textDraws(calls)) {
    const [x0, x1] = runExtent(draw);
    const key =
      `text ${JSON.stringify(draw.text)} @ ` +
      `${Math.round(draw.x)},${Math.round(draw.y)}`;
    marks.set(key, {
      what: `the HUD text run ${JSON.stringify(draw.text)}`,
      x0,
      x1,
      y0: draw.y,
      y1: draw.y,
    });
  }
  for (const blit of blits) {
    const key =
      `blit ${blit.id === "" ? "(painted)" : blit.id} @ ` +
      `${Math.round(blit.x)},${Math.round(blit.y)} ` +
      `${Math.round(blit.w)}x${Math.round(blit.h)}`;
    marks.set(key, {
      what: `the HUD blit of ${blit.id === "" ? "a painted surface" : blit.id}`,
      x0: blit.x,
      x1: blit.x + blit.w,
      y0: blit.y,
      y1: blit.y + blit.h,
    });
  }
  const { pixels, columns } = readPixelGrid(h);
  return { marks, pixels, columns };
}

/** The marks both frames of one pose placed, in the same spelling and place. */
function stillMarks(
  one: Map<string, Mark>,
  two: Map<string, Mark>,
): Map<string, Mark> {
  const out = new Map<string, Mark>();
  for (const [key, mark] of one) if (two.has(key)) out.set(key, mark);
  return out;
}

/**
 * The grid points that held still through each pose's own two frames and then
 * CHANGED between the poses: a readout drawn by a route neither the text runs
 * nor the blits can attribute.
 *
 * The stillness pair is what subtracts animation, exactly as it does for the
 * marks, and `MIN_EVIDENCE_DELTA` is `readouts.ts`'s own floor on what counts
 * as a visible difference rather than a rounding one.
 */
function readoutPoints(
  a: readonly [Frame, Frame],
  b: readonly [Frame, Frame],
): Mark[] {
  const points: Mark[] = [];
  const count = Math.min(...[...a, ...b].map((frame) => frame.pixels.length));
  const columns = a[0].columns;
  for (let i = 0; i < count; i += 1) {
    if (a[0].pixels[i] !== a[1].pixels[i]) continue;
    if (b[0].pixels[i] !== b[1].pixels[i]) continue;
    if (
      channelDelta(a[0].pixels[i] as number, b[0].pixels[i] as number) <
      MIN_EVIDENCE_DELTA
    )
      continue;
    const x = (i % columns) * PIXEL_STRIDE;
    const y = Math.floor(i / columns) * PIXEL_STRIDE;
    points.push({
      what: `the HUD mark rendered at ${x},${y}`,
      x0: x,
      x1: x,
      y0: y,
      y1: y,
    });
  }
  return points;
}

/** The horizontal span a text run covers, from its anchor and alignment. */
function runExtent(draw: {
  x: number;
  width: number;
  textAlign: string;
}): [number, number] {
  if (draw.textAlign === "center") {
    return [draw.x - draw.width / 2, draw.x + draw.width / 2];
  }
  if (draw.textAlign === "right" || draw.textAlign === "end") {
    return [draw.x - draw.width, draw.x];
  }
  return [draw.x, draw.x + draw.width];
}

/** The mark's box stays outside the field circle. */
function assertOffField(
  center: { x: number; y: number },
  fieldRadius: number,
  mark: Mark,
): void {
  const nearestX = Math.min(Math.max(center.x, mark.x0), mark.x1);
  const nearestY = Math.min(Math.max(center.y, mark.y0), mark.y1);
  const distance = Math.hypot(nearestX - center.x, nearestY - center.y);
  if (distance < fieldRadius) {
    fail(
      `${mark.what}: drawn clear of the containment field (no closer than ` +
        `${fieldRadius} device px to the stage center)`,
      `its nearest point sits ${Math.round(distance)} device px from the center, inside the field of play`,
    );
  }
}
