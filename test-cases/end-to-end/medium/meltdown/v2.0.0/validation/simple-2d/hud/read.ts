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

import { fail } from "../assert";
import { PANEL_X, STAGE_H, STAGE_W } from "../constants";
import {
  colorDistance,
  drawFrame,
  sampleColor,
  spelledRuns,
  type ControlsSnapshot,
  type DrawnRect,
  type Harness,
  type RectSnapshot,
  type Rgb,
  type TextRun,
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
 *
 * The runs are the LOGICAL ones the frame spells (`spelledRuns`), not the
 * `fillText` split: a build that letter-spaces its readouts draws `WAVE 3/15` a
 * glyph per call, and a figure read as a token or a pair read off one run wants
 * the words the panel shows, not how the build spaced them. Each run also
 * carries the spans it was spelled from, because the merge writes a space only
 * at a gap past the run's own tracking and concatenates verbatim inside it: a
 * label and its figure drawn as two calls set tight, or a letter-spaced label
 * whose figure sits one tracking gap along, read as the one run `WAVE3/15`, and
 * {@link saysWord} — a WHOLE-word reading — tests the parts beside the run so it
 * keeps the match it had call by call. Coalescing only ever adds a match.
 */
export async function panelRuns(h: Harness): Promise<TextRun[]> {
  const calls = await drawFrame(h);
  return spelledRuns(h, calls).filter(
    (span) => (span.left + span.right) / 2 >= PANEL_STRIP.x,
  );
}

/** Every run's text, for a failure that shows the reviewer the whole panel. */
export function textsOf(spans: readonly TextSpan[]): string[] {
  return spans.map((span) => span.text);
}

/**
 * A run of text that may name the spans it was spelled from: a {@link TextRun},
 * or a bare span, which spells itself.
 *
 * What every reader of a figure or a token below takes, so a caller holding
 * plain spans — one entry per call — reads them exactly as it always did.
 */
export type Spelled = TextSpan & { parts?: readonly TextSpan[] };

/**
 * Every string the runs show: each run, and each raw span it was spelled from,
 * each once per run.
 *
 * What a reading made on a WHOLE-string basis — a token boundary, a FIGURE, or
 * one frame's lines compared with another's for equal members — is made over,
 * for the reason {@link panelRuns} gives: the merge concatenates verbatim
 * inside the run's tracking, so two bare figures drawn tight in two calls, `40`
 * and `130`, come back as the one run `40130`, which is a figure neither of
 * them is — and two a word space apart as `40 130`, one run where the panel
 * drew two, which a reader that COUNTS must count over the parts — and only the parts
 * still carry the two the panel drew. A run drawn in one call spells itself and
 * is read once.
 */
export function spellingsOf(spans: readonly Spelled[]): string[] {
  return spans.flatMap((span) => {
    const texts = [span.text, ...(span.parts ?? []).map((part) => part.text)];
    return texts.filter((text, i) => texts.indexOf(text) === i);
  });
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
 * Whether some run reads `word` as a WHOLE word, ignoring case.
 *
 * `readsText` above is a substring reading, which is right for a multi-letter
 * label a build may frame however it likes; it is wrong for a one-letter word
 * such as a radiator face, where "N" would be found inside any word carrying an
 * "n". So the word is matched between non-alphanumeric boundaries — over the
 * run and the spans it was spelled from both, for the reason {@link panelRuns}
 * gives.
 */
export function saysWord(spans: readonly Spelled[], word: string): boolean {
  const escaped = word.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`(^|[^A-Za-z0-9])${escaped}([^A-Za-z0-9]|$)`, "i");
  return spellingsOf(spans).some((text) => pattern.test(text));
}

/** The compass word each face letter may equally be spelled out as. */
const FACE_WORDS: Record<string, string> = {
  N: "NORTH",
  E: "EAST",
  S: "SOUTH",
  W: "WEST",
};

/**
 * Whether the panel names the face `side` among its radiator faces.
 *
 * specs/towers.md names the faces `N`, `E`, `S` and `W` and
 * specs/instrumentation.md reports them that way, so the letter is the case's own
 * vocabulary; the compass word is accepted beside it because spelling a letter
 * out is a presentation choice no specification takes away.
 */
export function saysFace(spans: readonly Spelled[], side: string): boolean {
  return saysWord(spans, side) || saysWord(spans, FACE_WORDS[side] ?? side);
}

/**
 * The words a targeting read may be written with.
 *
 * `specs/hud.md` requires the panel to read "what the tower fires on" and fixes
 * no wording for it, so this is the case's own vocabulary rather than one
 * spelling: ground, air, and the words a build may spell a flyer or a
 * hits-everything read with. Which of the three readings a type is given is
 * `hud/targeting-read`'s requirement, decided without any fixed word at all;
 * what is asked here is only that a targeting read was drawn.
 */
const TARGETING_WORDS = [
  "ground",
  "air",
  "flying",
  "flier",
  "fliers",
  "flyer",
  "flyers",
  "everything",
] as const;

/** Whether the panel drew a targeting read at all, in any of those words. */
export function saysTargeting(spans: readonly Spelled[]): boolean {
  return TARGETING_WORDS.some((word) => saysWord(spans, word));
}

/**
 * The separators a build may group a figure's digit triples with.
 *
 * Grouping is formatting, and formatting is the build's: `"9,999"` is the one
 * figure `9999` drawn the way `Number.prototype.toLocaleString` draws it by
 * default. The ASCII space is deliberately not one of them, because a run's text
 * may carry two figures with a space between them and `"40 130"` is a reading of
 * `40` and `130` rather than one of `40130`. Nor is the full stop, which is the
 * decimal point: a build drawing `"1.5"` drew one and a half.
 */
const GROUP = "[,'\\u00A0\\u202F\\u2009]";

/** One figure as a run may carry it: grouped into triples, or plain. */
const DRAWN = new RegExp(
  `\\d{1,3}(?:${GROUP}\\d{3})+(?:\\.\\d+)?|\\d+(?:\\.\\d+)?`,
  "g",
);

/** Every group separator inside one figure, for dropping before it is read. */
const GROUPS = new RegExp(GROUP, "g");

/**
 * Every figure the runs carry, as numbers.
 *
 * A string is scanned for maximal runs of digits with an optional decimal part
 * and an optional grouping of those digits into triples, so `"7/26"` reads as
 * `7` and `26`, `"SIZE 4x4"` as `4` and `4`, `"9.0s"` as `9`, `"x2.15"` as
 * `2.15`, and `"9,999"` as the one figure `9999` the build drew rather than as
 * two. Every spelling of a run is scanned — the run, and each span it was
 * spelled from — for the reason {@link spellingsOf} gives.
 */
export function numbersIn(spans: readonly Spelled[]): number[] {
  const found: number[] = [];
  for (const text of spellingsOf(spans)) {
    const matches = text.match(DRAWN);
    if (matches === null) continue;
    for (const match of matches) found.push(Number(match.replace(GROUPS, "")));
  }
  return found;
}

/** Whether some figure the runs carry sits within `tolerance` of `value`. */
export function readsNumber(
  spans: readonly Spelled[],
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
  spans: readonly Spelled[],
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
export function runsInside<T extends TextSpan>(
  spans: readonly T[],
  rect: RectSnapshot,
  pad = CAPTION_PAD,
): T[] {
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
export function infoRuns<T extends TextSpan>(
  spans: readonly T[],
  controls: ControlsSnapshot,
): T[] {
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
  runs: TextRun[];
  info: TextRun[];
  controls: ControlsSnapshot;
}> {
  const runs = await panelRuns(h);
  const { controls } = h.snapshot();
  return { runs, info: infoRuns(runs, controls), controls };
}
