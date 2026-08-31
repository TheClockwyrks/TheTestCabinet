// presentation — where a frame's text runs landed, and how far their glyphs sit
// from the background behind them.
//
// `presentation/text-legible` is the one point that reads this, and what it
// needs beyond the harness's `drawnTextSpans` is the VERTICAL extent of a run:
// a span carries its baseline anchor and its horizontal extent, and the glyphs
// sit above that baseline by an amount only the font in force can say. So the
// font is taken from the context itself — the recorder captures every property
// set, and the `font` a build set before a `fillText` is the font that call
// drew with — and the box is built from its own pixel size.
//
// THE BOX IS DELIBERATELY GENEROUS: a full em above the baseline and a quarter
// below it. A box too small would miss the glyphs of a build whose typeface
// sits unusually high and read its perfectly legible text as invisible, which
// is the worse of the two errors. The reading below is a percentile over what
// was actually painted rather than a mean over the box, so the extra background
// a generous box takes in cannot dilute it.
//
// WHAT IS READ IS A DISTANCE, NEVER A COLOUR. Floe fixes no palette
// (specs/overview.md: "The palette, the type, and every other aspect of the
// look are yours"), so the background is whatever the build painted behind its
// own text — the commonest colour of the run's box — and the reading is how far
// the glyph pixels sit from that.

import { drawnTextSpans, type DrawCall, type Harness, type Rgb } from "../harness";
import { colorDistance } from "../harness";
import type { Raster } from "./raster";

/** The canvas default when a build never sets one, in CSS pixels. */
const DEFAULT_FONT_PX = 10;

/** How far above the baseline the box reaches, in ems of the font in force. */
const ASCENT_EMS = 1;

/** How far below the baseline it reaches, in ems. */
const DESCENT_EMS = 0.25;

/** How far apart the box is sampled, in stage units. */
const SAMPLE_STEP = 1;

/**
 * How far from the background a pixel must sit to count as painted rather than
 * as the background itself.
 *
 * Twelve of `441`. Above the rounding and the anti-aliasing of an edge, and a
 * fifth of the distance the point requires, so nothing this admits can carry
 * the verdict on its own.
 */
const PAINTED_MIN = 12;

/** How many painted pixels a run needs before its distance means anything. */
const PAINTED_COUNT_MIN = 8;

/**
 * Which painted pixel the reading is taken at: the 90th percentile.
 *
 * The glyph's own core rather than the anti-aliased edge that surrounds it, and
 * robust to a handful of stray pixels either way.
 */
const READING_PERCENTILE = 0.9;

/** One run of text a frame drew, and the box its glyphs sit in. */
export interface TextBox {
  text: string;
  /** The box, in logical stage units. */
  left: number;
  right: number;
  top: number;
  bottom: number;
  /** The baseline anchor's `y`, which is what the HUD points read. */
  baseline: number;
}

/** The `px` size of a CSS font shorthand, or `null` where it names none. */
function fontSize(font: unknown): number | null {
  if (typeof font !== "string") return null;
  const found = /(\d+(?:\.\d+)?)px/.exec(font);
  return found === null ? null : Number(found[1]);
}

/**
 * Every text run of `calls`, with the box its glyphs occupy.
 *
 * The runs come from the harness, which places each anchor through the
 * transform the context held at the call; the font in force at each call is
 * tracked here in the same order, so the two line up run for run.
 */
export function textBoxes(
  h: Harness,
  calls: readonly DrawCall[],
): TextBox[] {
  const view = h.engine.viewport();
  const spans = drawnTextSpans(h, calls);

  // The font each accepted text call drew under, in the order the harness
  // accepts them, so `sizes[i]` belongs to `spans[i]`.
  const sizes: number[] = [];
  let current = DEFAULT_FONT_PX;
  for (const call of calls) {
    if (call.kind === "set" && call.property === "font") {
      current = fontSize(call.value) ?? current;
      continue;
    }
    if (call.kind !== "call" || call.text === undefined) continue;
    const [text, ax, ay] = call.args;
    if (typeof text !== "string" || typeof ax !== "number") continue;
    if (typeof ay !== "number") continue;
    // The size in logical units, under the same scale the anchor took.
    const m = call.text.transform;
    sizes.push((current * Math.hypot(m.c, m.d)) / view.scale);
  }

  return spans.map((span, index) => {
    const size = sizes[index] ?? DEFAULT_FONT_PX;
    return {
      text: span.text,
      left: span.left,
      right: span.right,
      top: span.y - ASCENT_EMS * size,
      bottom: span.y + DESCENT_EMS * size,
      baseline: span.y,
    };
  });
}

/** What a run's box holds: the background behind it, and how far its glyphs sit. */
export interface Legibility {
  /** The commonest colour of the box: what the run is drawn over. */
  background: Rgb;
  /** How far the run's glyph pixels sit from it, as an RGB distance out of 441. */
  distance: number;
  /** How many sampled pixels of the box were painted at all. */
  painted: number;
}

/** Read one run's box off the frame: its background, and its glyphs' distance. */
export function legibilityOf(raster: Raster, box: TextBox): Legibility {
  const samples: Rgb[] = [];
  for (let y = box.top; y <= box.bottom; y += SAMPLE_STEP) {
    for (let x = box.left; x <= box.right; x += SAMPLE_STEP) {
      samples.push(raster.at(x, y));
    }
  }
  if (samples.length === 0) {
    return { background: { r: 0, g: 0, b: 0 }, distance: 0, painted: 0 };
  }

  // The commonest colour, over buckets sixteen levels wide so a gradient or a
  // dither still reads as one background.
  const buckets = new Map<number, { n: number; r: number; g: number; b: number }>();
  for (const sample of samples) {
    const key =
      ((sample.r >> 4) << 8) | ((sample.g >> 4) << 4) | (sample.b >> 4);
    const held = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
    held.n += 1;
    held.r += sample.r;
    held.g += sample.g;
    held.b += sample.b;
    buckets.set(key, held);
  }
  let top = { n: 0, r: 0, g: 0, b: 0 };
  for (const held of buckets.values()) if (held.n > top.n) top = held;
  const background: Rgb = {
    r: top.r / top.n,
    g: top.g / top.n,
    b: top.b / top.n,
  };

  const painted = samples
    .map((sample) => colorDistance(sample, background))
    .filter((distance) => distance >= PAINTED_MIN)
    .sort((a, b) => a - b);
  if (painted.length < PAINTED_COUNT_MIN) {
    return { background, distance: 0, painted: painted.length };
  }
  const at = Math.floor(READING_PERCENTILE * (painted.length - 1));
  return { background, distance: painted[at], painted: painted.length };
}
