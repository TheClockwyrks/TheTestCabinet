// hud/read — how this group reads the build panel.
//
// Every entry is a READING or a PLACE, never a threshold. `panelRuns` says which
// runs of text landed in the panel's strip, `numbersIn` says which figures those
// runs carry, `runsInside` attributes a run to the control it was drawn on, and
// `sampleRect` says what colour a control was painted. Every figure a check
// asserts, and every tolerance it allows, stays in the check that asserts it.
//
// WHY THE PANEL IS READ AS TEXT AND COLOUR RATHER THAN AS STATE. Every item in
// this group is about what the BUILD PANEL DRAWS, and the snapshot cannot answer
// that: a build whose `money` is right and whose panel never draws it has failed
// exactly the requirement `hud.money-readout` carries. So a check here runs one
// frame, takes the runs of text that frame put in the panel, and reads the
// figures out of them.
//
// NOTHING HERE KNOWS A COLOUR, A FONT OR A LAYOUT. specs/overview.md leaves the
// palette, the type and the panel's arrangement to the build, and specs/hud.md
// says only WHAT the panel holds. So a reading below is either "some run of text
// in the panel carries this figure", "some run drawn on the rectangle the build
// itself reported for this control carries this figure", or "these two paintings
// of the same rectangle differ" — none of which fixes anything the specification
// left open.
//
// Local to this group. `controls/panel.ts` keeps its own anchors and control
// readings because it poses a different question with them — which input reached
// an action — and two small local files are cheaper than a shared one both
// groups have to agree about while their agents write them side by side.

import { PANEL_X, STAGE_H, STAGE_W } from "../../src/constants";
import { fail } from "../assert";
import {
  colorDistance,
  drawFrame,
  drawnTextSpans,
  sampleColor,
  type ControlsSnapshot,
  type DrawnRect,
  type Harness,
  type RectSnapshot,
  type Rgb,
  type TextSpan,
} from "../harness";

/**
 * The panel's strip, as specs/floor.md fixes it: `x` from `PANEL_X` (`986`) to
 * the stage's right edge, the full height of the stage.
 *
 * "No panel readout or control is drawn on the floor", so a reading of the panel
 * is a reading of this rectangle and of nothing else.
 */
export const PANEL_STRIP: RectSnapshot = {
  x: PANEL_X,
  y: 0,
  w: STAGE_W - PANEL_X,
  h: STAGE_H,
};

/**
 * Run one frame and hand back every run of text it drew INSIDE the panel strip.
 *
 * A run is placed by the middle of its glyphs rather than by its anchor, because
 * a build aligns its readouts however it likes and a right-aligned figure is
 * anchored at the far edge of the strip with its glyphs to the left of it.
 */
export async function panelRuns(h: Harness): Promise<TextSpan[]> {
  const calls = await drawFrame(h);
  return drawnTextSpans(h, calls).filter(
    (span) => (span.left + span.right) / 2 >= PANEL_STRIP.x,
  );
}

/** Every run's text, for a failure that shows the reviewer the whole panel. */
export function textsOf(spans: readonly TextSpan[]): string[] {
  return spans.map((span) => span.text);
}

/**
 * Whether some run in `spans` carries `text`, ignoring case and surrounding
 * punctuation.
 *
 * Substring rather than equality, for the reason `drewText` in the harness gives:
 * the words a check asserts are the specification's, but how a build frames them
 * — a label beside them, a marker around them, padding — is the build's.
 */
export function readsText(spans: readonly TextSpan[], text: string): boolean {
  const wanted = text.trim().toLowerCase();
  return spans.some((span) => span.text.toLowerCase().includes(wanted));
}

/**
 * Every figure the runs carry, as numbers.
 *
 * A run is scanned for maximal runs of digits with an optional decimal part, so
 * `"7/26"` reads as `7` and `26`, `"SIZE 4x4"` as `4` and `4`, `"9.0s"` as `9`,
 * and `"x2.15"` as `2.15`. Thousands separators are dropped first, so a build
 * that writes `"9,999"` reads as the one figure `9999` it drew rather than as two.
 */
export function numbersIn(spans: readonly TextSpan[]): number[] {
  const found: number[] = [];
  for (const span of spans) {
    const matches = span.text.replace(/,/g, "").match(/\d+(?:\.\d+)?/g);
    if (matches === null) continue;
    for (const match of matches) found.push(Number(match));
  }
  return found;
}

/** Whether some figure the runs carry sits within `tolerance` of `value`. */
export function readsNumber(
  spans: readonly TextSpan[],
  value: number,
  tolerance = 0,
): boolean {
  return numbersIn(spans).some((found) => Math.abs(found - value) <= tolerance);
}

/**
 * The figure the runs carry that sits nearest `value`, or the failure that the
 * panel drew no figure at all.
 *
 * What a check reads when it has to follow one readout across two moments: the
 * nearest figure at each moment is the reading, and the check then asserts how
 * far it moved.
 */
export function nearestNumber(
  spans: readonly TextSpan[],
  value: number,
  requirement: string,
): number {
  const numbers = numbersIn(spans);
  if (numbers.length === 0) {
    return fail(requirement, "the panel drew no figure at all");
  }
  return numbers.reduce((best, found) =>
    Math.abs(found - value) < Math.abs(best - value) ? found : best,
  );
}

/**
 * How far outside a control's reported rectangle a run drawn ON that control may
 * be anchored, in logical units.
 *
 * The rectangle the panel reports is the control's TAP TARGET
 * (specs/instrumentation.md, `controls`), and specs/hud.md never says the
 * caption has to sit inside it: a build may letter an entry's name a shade above
 * or below the area a finger presses. Eight units is a quarter of
 * `MIN_TOUCH_TARGET`, wide enough for that and far too narrow to reach the next
 * control, which is at least a whole target away.
 */
export const CAPTION_PAD = 8;

/** Whether a point lies inside `rect`, grown by `pad` on every side. */
export function inside(
  rect: RectSnapshot,
  x: number,
  y: number,
  pad = 0,
): boolean {
  return (
    x >= rect.x - pad &&
    x <= rect.x + rect.w + pad &&
    y >= rect.y - pad &&
    y <= rect.y + rect.h + pad
  );
}

/** The runs anchored on `rect`, which is where a control's own caption lands. */
export function runsInside(
  spans: readonly TextSpan[],
  rect: RectSnapshot,
  pad = CAPTION_PAD,
): TextSpan[] {
  return spans.filter((span) => inside(rect, span.x, span.y, pad));
}

/** Every rectangle the panel reported, the shop entries included. */
export function everyControl(controls: ControlsSnapshot): RectSnapshot[] {
  const optional = [
    controls.rotate,
    controls.cancel,
    controls.upgrade,
    controls.sell,
  ].filter((rect): rect is RectSnapshot => rect !== null);
  return [
    ...controls.shop,
    ...optional,
    controls.send,
    controls.speed,
    controls.pause,
    controls.mute,
  ];
}

/**
 * The runs of the panel that are not drawn on any control: the readouts and the
 * information area.
 *
 * specs/hud.md gives the panel a shop and a set of controls, each of which the
 * build reports a rectangle for, and "one area of the panel shows tower
 * information". Subtracting the controls is how a check reads that area without
 * the specification having to fix where it sits.
 *
 * SUBTRACTION TAKES NO {@link CAPTION_PAD}, WHERE ATTRIBUTION DOES. The pad exists
 * so a caption lettered just outside its own tap target is still read as that
 * control's; growing every control by it here would instead swallow whatever the
 * build drew immediately above the first shop entry or below the last, and a
 * readout is commonly the thing sitting there. So a run is subtracted only where
 * it was actually anchored on a control, and the cost of that choice — a caption
 * drawn outside its control reading as part of the information area — is the
 * harmless direction.
 */
export function infoRuns(
  spans: readonly TextSpan[],
  controls: ControlsSnapshot,
): TextSpan[] {
  const rects = everyControl(controls);
  return spans.filter(
    (span) => !rects.some((rect) => inside(rect, span.x, span.y)),
  );
}

/**
 * `cols` by `rows` colours sampled evenly over the interior of `rect`.
 *
 * Inset by {@link SAMPLE_INSET} so every sample, and the small cluster
 * {@link sampleColor} averages around it, stays inside the rectangle rather than
 * reading whatever the build painted beside it.
 */
export function sampleRect(
  h: Harness,
  rect: RectSnapshot,
  cols: number,
  rows: number,
): Rgb[] {
  const x0 = rect.x + SAMPLE_INSET;
  const y0 = rect.y + SAMPLE_INSET;
  const w = rect.w - SAMPLE_INSET * 2;
  const hh = rect.h - SAMPLE_INSET * 2;
  const samples: Rgb[] = [];
  for (let i = 0; i < cols; i += 1) {
    for (let j = 0; j < rows; j += 1) {
      samples.push(
        sampleColor(
          h,
          x0 + (w * (i + 0.5)) / cols,
          y0 + (hh * (j + 0.5)) / rows,
        ),
      );
    }
  }
  return samples;
}

/**
 * How far inside a rectangle a colour sample is taken, in logical units.
 *
 * {@link sampleColor} averages the centre pixel with four neighbours three units
 * out, so a sample taken any closer than this to an edge would read the paint on
 * the other side of it.
 */
const SAMPLE_INSET = 4;

/** The largest distance between two paintings of the same points, out of 441. */
export function largestChange(
  before: readonly Rgb[],
  after: readonly Rgb[],
): number {
  let largest = 0;
  for (let i = 0; i < before.length && i < after.length; i += 1) {
    largest = Math.max(largest, colorDistance(before[i], after[i]));
  }
  return largest;
}

/** A rectangle a frame drew, keyed by where it was drawn, to 0.5 of a unit. */
export function rectKey(rect: DrawnRect): string {
  return `${Math.round(rect.left * 2) / 2},${Math.round(rect.top * 2) / 2}`;
}

/**
 * The narrowest rectangle the frame drew at each place, keyed by {@link rectKey}.
 *
 * A read drawn as a track with a fill over it puts two rectangles at the same
 * corner — the full-length track and the part of it the figure fills — and it is
 * the FILL whose extent the reading is about. Taking the narrowest at each corner
 * is what reads the fill rather than the track, and a build that draws the fill
 * alone is read exactly the same way.
 */
export function narrowestAt(
  rects: readonly DrawnRect[],
): Map<string, DrawnRect> {
  const narrowest = new Map<string, DrawnRect>();
  for (const rect of rects) {
    const key = rectKey(rect);
    const held = narrowest.get(key);
    if (held === undefined || rect.w < held.w) narrowest.set(key, rect);
  }
  return narrowest;
}

/** A rectangle as a one-line description, for a failure the reviewer can place. */
export function showRect(rect: DrawnRect): string {
  return `${rect.method} at (${rect.left.toFixed(1)}, ${rect.top.toFixed(
    1,
  )}) ${rect.w.toFixed(1)}x${rect.h.toFixed(1)}`;
}

/**
 * One frame, and the panel it drew: every run in the strip, the runs that are not
 * on any control, and the rectangles the panel reported for that frame.
 *
 * `info` is the reading almost every check in this group takes. specs/hud.md
 * gives the panel a shop of eight entries and a set of controls, each of which
 * the build reports a rectangle for, and the readouts and the information area
 * are what is left. Subtracting the controls is not tidiness: a build is free to
 * letter its shop rows with the digits `1` to `8` that arm them
 * (specs/controls.md), and a check reading a wave number or a countdown out of
 * the whole strip would find those digits and call them its readout.
 */
export async function readPanel(h: Harness): Promise<{
  runs: TextSpan[];
  info: TextSpan[];
  controls: ControlsSnapshot;
}> {
  const runs = await panelRuns(h);
  const { controls } = h.snapshot();
  return { runs, info: infoRuns(runs, controls), controls };
}
