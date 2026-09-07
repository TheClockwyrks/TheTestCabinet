// field — reading what the build actually put on the canvas. Local to this group.
//
// Three items here are decided by pixels rather than by the snapshot:
// `field-fit` asks whether a body posed near an edge of the field is drawn where
// the engine's fit puts it, `seam-drawn-both-sides` asks whether a body straddling
// a seam is drawn at both edges, and `star-fixed-at-centre` asks where the star's
// core is drawn. No other group in this project asks any of the three, so the
// arithmetic lives beside them rather than in the shared harness.
//
// WHY EVERY READING IS A COLOUR AND NOT A BRIGHTNESS. `specs/overview.md` fixes
// no palette. It requires the star to read as a bright core and a rock to read
// apart from the field, and a build is free to answer either in a saturated hue
// whose luminance is low — a core of deep blue is a bright core to a player and a
// dim one to a luminance meter. So nothing here weighs a channel: a pixel is the
// thing being looked for when its COLOUR stands far enough from the field's, which
// is the same reading `presentation/` takes.
//
// WHY A WHOLE FRAME AND NOT A HANDFUL OF POINTS. `specs/overview.md` fixes no
// palette, no rock shape and no line weight — only that a body "reads apart from
// the field". A point sampled at the middle of an OUTLINED rock reads the field
// through it, so every reading below is taken over a run of pixels: a line
// crossing a body meets an outline twice however it is drawn and covers a filled
// body along its whole chord, and one reading therefore serves both looks.
//
// WHY THE CONTROL IS THE SAME EMPTY GAME FLOWN TWICE. There is no colour to hold
// a reading against, so the only honest baseline for "did the build draw a body
// here" is the same canvas, at the same tick of the same game, without that body.
// {@link paintedWithAndWithout} runs the scenario twice, each run opening with
// `reset()` — which `specs/instrumentation.md` returns every declared field to
// its title value and `simTime` to `0` — and `startPlaying`, which empties the
// field and shuts every spawner. The field holds no rock, no round and no saucer,
// so the two frames hold the same world at the same moment and differ by the
// thing being looked for. Whatever the build paints over its field from the
// clock (a vignette, a HUD readout, a pulsing halo) is painted the same way in
// both and cancels.
//
// AND WHY THAT IS ENOUGH: EVERY READING HERE IS A CLAIM THAT SOMETHING WAS
// DRAWN. What the build paints at random — a twinkling starfield, a dithered
// edge — is legal appearance the specification says nothing about, and it can
// differ between the two frames. Such a difference can only ADD to a count of
// changed pixels, so it cannot take a body that was drawn below a presence
// floor; a claim that nothing was drawn would need a bound measured from the
// build's own idle frames instead, and no check in this group makes one.
//
// NO THRESHOLD LIVES HERE. What counts as "changed" and how many changed pixels a
// verdict takes are each check's own figures, stated in the check beside the
// specification rule they serve.

import { startPlaying, type Harness, type Rgb } from "../harness";

/** One whole frame of the backing store, as raw RGBA bytes. */
export interface Frame {
  readonly data: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
}

/** The frame currently on the canvas, copied out of the backing store. */
export function readFrame(h: Harness): Frame {
  const width = h.canvas.width;
  const height = h.canvas.height;
  const { data } = h.ctx.getImageData(0, 0, width, height);
  return { data, width, height };
}

/** The colour at a device pixel; black for anything off the surface. */
export function rgbAt(frame: Frame, x: number, y: number): Rgb {
  if (x < 0 || y < 0 || x >= frame.width || y >= frame.height) {
    return { r: 0, g: 0, b: 0 };
  }
  const at = (y * frame.width + x) * 4;
  return { r: frame.data[at], g: frame.data[at + 1], b: frame.data[at + 2] };
}

/** A straight run of device pixels a reading is taken along. */
export interface Span {
  /** `"row"` walks `x` at a fixed `y`; `"column"` walks `y` at a fixed `x`. */
  axis: "row" | "column";
  /** The fixed device coordinate the run sits on. */
  line: number;
  /** The first device coordinate walked, inclusive. */
  from: number;
  /** The last device coordinate walked, inclusive. */
  to: number;
}

/** The device pixel at `along` on a span. */
function pixelOn(span: Span, along: number): { x: number; y: number } {
  return span.axis === "row"
    ? { x: along, y: span.line }
    : { x: span.line, y: along };
}

/** The colour of every pixel of a span, in order. */
export function coloursAlong(frame: Frame, span: Span): Rgb[] {
  const values: Rgb[] = [];
  for (
    let along = Math.round(span.from);
    along <= Math.round(span.to);
    along += 1
  ) {
    const at = pixelOn(span, along);
    values.push(rgbAt(frame, at.x, at.y));
  }
  return values;
}

/**
 * The colour a run of pixels mostly carries: each channel's own median.
 *
 * The bare field's own level, whatever the build painted it. A median rather
 * than a mean, so a few pixels of something else on the line — a star of a
 * starfield, a speck of a texture — do not move the reading.
 */
export function medianColour(colours: readonly Rgb[]): Rgb {
  const channel = (pick: (c: Rgb) => number): number => {
    const sorted = colours.map(pick).sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)] ?? 0;
  };
  return {
    r: channel((c) => c.r),
    g: channel((c) => c.g),
    b: channel((c) => c.b),
  };
}

/** How far the colour at one device pixel moved between two frames, of 441. */
export function changeAt(
  bare: Frame,
  drawn: Frame,
  x: number,
  y: number,
): number {
  const was = rgbAt(bare, x, y);
  const now = rgbAt(drawn, x, y);
  return Math.hypot(now.r - was.r, now.g - was.g, now.b - was.b);
}

/** How many pixels of a span moved by more than `threshold` between two frames. */
export function changedOver(
  bare: Frame,
  drawn: Frame,
  span: Span,
  threshold: number,
): number {
  let changed = 0;
  for (
    let along = Math.round(span.from);
    along <= Math.round(span.to);
    along += 1
  ) {
    const at = pixelOn(span, along);
    if (changeAt(bare, drawn, at.x, at.y) > threshold) changed += 1;
  }
  return changed;
}

/**
 * Flow the same posed game twice — once with `pose` applied and once without —
 * and hand back the frame each left on the canvas.
 *
 * The BARE run goes first, so the frame still on the canvas when this returns is
 * the one holding what the check is about, which is the frame `captureStill`
 * keeps.
 */
export async function paintedWithAndWithout(
  h: Harness,
  pose: () => void,
  ticks: number,
): Promise<{ bare: Frame; drawn: Frame }> {
  const run = async (posed: boolean): Promise<Frame> => {
    h.debug.reset();
    startPlaying(h);
    if (posed) pose();
    await h.advance(ticks);
    return readFrame(h);
  };

  const bare = await run(false);
  const drawn = await run(true);
  return { bare, drawn };
}
