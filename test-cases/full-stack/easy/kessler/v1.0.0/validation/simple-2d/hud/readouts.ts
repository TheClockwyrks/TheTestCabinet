// hud — the shared differential reading the HUD items decide with.
//
// specs/screens.md fixes WHAT the HUD reports — score, lives, wave, effects —
// but "Kessler fixes no palette, no font, and no layout for its screens", and
// only the score is fixed to digits, so a readout may be text, icons, or
// reused pod sprites, anywhere the build's design put them. The one reading
// that follows from the spec alone is differential: two frames of the same
// posed scene that differ ONLY in a posed value must render differently,
// because a readout that draws that value has different values to draw.
//
// Animation is subtracted with a same-value baseline pair: whatever differed
// between two consecutive frames of the SAME value is frame-to-frame noise,
// and evidence must be a change that was stable across that pair. The frame
// is read three ways at once — text runs and sprite blits with their device
// anchors, and a stride-4 grid of the rendered pixels — so a readout drawn by
// any route shows up. A `keep` mask confines the evidence to the part of the
// stage where only the HUD can answer, for the poses (shield, pierce) that
// also dress an object in the world.

import { fail } from "../assert";
import { STAGE_CX, STAGE_CY } from "../constants";
import { drawnTextLines } from "../case-harness/text";
import { drawnText, textDraws, type DrawCall, type Harness } from "../harness";

/** The pixel grid's sampling step, in device pixels: finer than any readout. */
export const PIXEL_STRIDE = 4;

/** One frame, read for the differential comparison. */
export interface FrameRead {
  /** The frame's draw calls, for the direct digit readings. */
  calls: DrawCall[];
  /** Each placed mark — text run or blit — keyed by what and where. */
  marks: Map<string, { x: number; y: number }>;
  /** The stride-4 grid of the frame's pixels, packed 0xRRGGBB. */
  pixels: number[];
  /** Grid columns, so an index maps back to its device point. */
  columns: number;
}

/**
 * The frame's pixels off the harness's canvas, sampled on the stride grid.
 *
 * The one reading that does not care HOW a mark reached the frame, which is
 * why it is read alongside the calls rather than instead of them.
 */
export function readPixelGrid(h: Harness): {
  pixels: number[];
  columns: number;
} {
  const { width, height } = h.canvas;
  const data = h.ctx.getImageData(0, 0, width, height).data;
  const pixels: number[] = [];
  for (let y = 0; y < height; y += PIXEL_STRIDE) {
    for (let x = 0; x < width; x += PIXEL_STRIDE) {
      const i = (y * width + x) * 4;
      pixels.push((data[i] << 16) | (data[i + 1] << 8) | data[i + 2]);
    }
  }
  return { pixels, columns: Math.ceil(width / PIXEL_STRIDE) };
}

/** Run one frame and read everything its render put on screen. */
export async function readFrame(h: Harness): Promise<FrameRead> {
  const { calls, blits } = await h.frameDraw();
  const marks = new Map<string, { x: number; y: number }>();
  for (const draw of textDraws(calls)) {
    marks.set(
      `text ${JSON.stringify(draw.text)} @ ${Math.round(draw.x)},${Math.round(draw.y)}`,
      { x: draw.x, y: draw.y },
    );
  }
  for (const blit of blits) {
    marks.set(
      `blit ${blit.id === "" ? "(painted)" : blit.id} @ ` +
        `${Math.round(blit.x)},${Math.round(blit.y)} ` +
        `${Math.round(blit.w)}x${Math.round(blit.h)}`,
      { x: blit.x + blit.w / 2, y: blit.y + blit.h / 2 },
    );
  }
  const { pixels, columns } = readPixelGrid(h);
  return { calls, marks, pixels, columns };
}

/**
 * What a pixel change must amount to before it is evidence. specs/screens.md
 * has "each readout ... legible at a glance", so a readout's change is a
 * visible one: a glyph or icon flipping between foreground and background,
 * not a background shimmer. A same-value baseline pair already subtracts
 * per-frame animation; these two floors also discard what such a pair cannot
 * see — an ambient fade caught mid-phase — by demanding a contrast no ambient
 * shimmer reaches (8 of 255 on some channel) at more than an isolated sample
 * point (2 of the stride-4 grid's points; a legible readout at the 1000-unit
 * stage covers far more).
 */
export const MIN_EVIDENCE_DELTA = 8;
const MIN_EVIDENCE_POINTS = 2;

/** The largest single-channel difference between two packed 0xRRGGBB colors. */
export function channelDelta(a: number, b: number): number {
  return Math.max(
    Math.abs(((a >> 16) & 0xff) - ((b >> 16) & 0xff)),
    Math.abs(((a >> 8) & 0xff) - ((b >> 8) & 0xff)),
    Math.abs((a & 0xff) - (b & 0xff)),
  );
}

/** The marks present in exactly one of the two frames. */
function markDiff(
  a: Map<string, { x: number; y: number }>,
  b: Map<string, { x: number; y: number }>,
): Map<string, { x: number; y: number }> {
  const out = new Map<string, { x: number; y: number }>();
  for (const [key, at] of a) if (!b.has(key)) out.set(key, at);
  for (const [key, at] of b) if (!a.has(key)) out.set(key, at);
  return out;
}

/**
 * Keep only points farther than `radius` logical units from the stage
 * center — the mask for a pose that also dresses an object in the world.
 */
export function keepOutside(
  h: Harness,
  radius: number,
): (x: number, y: number) => boolean {
  const center = h.device(STAGE_CX, STAGE_CY);
  const bound = radius * h.viewport().scale;
  return (x, y) => Math.hypot(x - center.x, y - center.y) > bound;
}

/**
 * The frame changed with the posed value: some mark or pixel differs between
 * `again` and `changed`, was stable between `base` and `again` (so it is not
 * animation), and lies where `keep` allows. Fails the running check when
 * nothing qualifies.
 */
export function assertReadoutChanged(
  base: FrameRead,
  again: FrameRead,
  changed: FrameRead,
  keep: ((x: number, y: number) => boolean) | null,
  requirement: string,
): void {
  const noise = markDiff(base.marks, again.marks);
  for (const [key, at] of markDiff(again.marks, changed.marks)) {
    if (noise.has(key)) continue;
    if (keep !== null && !keep(at.x, at.y)) continue;
    return;
  }
  const count = Math.min(
    base.pixels.length,
    again.pixels.length,
    changed.pixels.length,
  );
  let freshPoints = 0;
  for (let i = 0; i < count; i += 1) {
    if (base.pixels[i] !== again.pixels[i]) continue;
    if (channelDelta(again.pixels[i], changed.pixels[i]) < MIN_EVIDENCE_DELTA)
      continue;
    if (keep !== null) {
      const x = (i % again.columns) * PIXEL_STRIDE;
      const y = Math.floor(i / again.columns) * PIXEL_STRIDE;
      if (!keep(x, y)) continue;
    }
    freshPoints += 1;
    if (freshPoints >= MIN_EVIDENCE_POINTS) return;
  }
  fail(
    requirement,
    "no stable part of the rendered frame changed with the posed value " +
      "(every mark and pixel that differed also differed between two frames " +
      "of the same value, i.e. was animation)",
  );
}

/**
 * Whether the frame drew `digits` as text, once every non-digit is stripped
 * (so "SCORE 1,050" shows "1050"): inside one logical run — the package's
 * (`case-harness/text.ts`), which spells a letter-spaced figure drawn one
 * glyph per call as the string it makes and folds a restruck glyph to one —
 * or across the frame's raw strings in draw order, for a figure whose glyphs
 * sit too far apart for the merge rule to coalesce. Each reading can only add
 * a match; the one fact added here is the digit grouping specs/screens.md
 * leaves to the build.
 */
export function digitsShown(
  calls: readonly DrawCall[],
  digits: string,
): boolean {
  const figures = (text: string) => text.replace(/\D+/g, "");
  return (
    drawnTextLines(calls).some((run) => figures(run).includes(digits)) ||
    drawnText(calls).map(figures).join("").includes(digits)
  );
}
