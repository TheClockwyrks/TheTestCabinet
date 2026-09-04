// extras/solved-mark-survives-hue-removal — the solved state is readable with hue
// removed.
//
// THE RULE. The Extras select screen lists the ten challenges, "each row showing
// its number, its name, and whether it is solved, WITH SOLVED READABLE WITHOUT
// RELYING ON HUE ALONE" (`specs/modes/extras.md`, The select screen).
// `specs/modes/campaign.md` says the same of its own rows: each shows "its state,
// with the state readable without relying on hue alone."
//
// WHAT "WITHOUT RELYING ON HUE ALONE" IS READ AS. Take the frame's colours away
// and keep only how light each pixel is — the grayscale projection — and the
// solved row must still be drawn differently from the way it was drawn unsolved.
// A build that marked solved by swapping one colour for another of the same
// lightness leaves a projection that is pixel for pixel what it was, and a player
// who cannot separate those two hues is told nothing; a build that marks it with a
// word, a glyph, a rule, a check, or a colour of a different lightness leaves one
// that differs. The projection is Rec. 709 luminance, which is `color.ts`'s
// {@link luminance}, and two pixels count as different when their lightness or
// their coverage moved by more than `CHANNEL_EPSILON` — the same span every other
// pixel comparison in this project is made to.
//
// THE CONFIGURATION IS ONE FRAME AND THE NEXT. The Extras select screen is
// arrived at fresh and its row for challenge 3 is read; challenge 3 is then marked
// solved through `setSolved` — "Adds `index` to that mode's solved set"
// (`specs/instrumentation.md`), which is the one thing that pose touches — and the
// SAME band is read again. Nothing else moved between the two frames: no screen
// transition, no record, no run, and the highlight is pinned to row 1, which is
// neither frame's solved row. So the only thing the two frames can differ by is
// the state of row 3.
//
// The band is found by the row's name, because `specs/` fixes no geometry, no
// wording and no mark for this screen.
//
// THE VERDICT. At least `MIN_DISTINCT_PIXELS` pixels of row 3's band differ in
// the grayscale projection once its challenge is solved.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertDefined,
  assertEqual,
  assertGreaterThan,
  assertGreaterThanOrEqual,
} from "../assert";
import { EXTRA_NAMES } from "../challenges";
import { STAGE_W } from "../constants";
import {
  CHANNEL_EPSILON,
  captureStill,
  createHarness,
  luminance,
  openSelect,
  openTitle,
  rgbOf,
  textDraws,
  type Harness,
  type Pixel,
  type PixelRect,
  type TextDraw,
} from "../harness";

/** The challenge this point marks solved, and the row the highlight is pinned to. */
const SOLVED_INDEX = 2;
const PINNED_ROW = 0;

/**
 * The least number of pixels of the row's band whose lightness must move.
 *
 * The case's own figure for "visibly distinct" elsewhere is one percent of a tray
 * slot — sixty-two pixels of a `208 x 30` rectangle
 * (`editor/a-spent-entry-is-drawn-distinct`) — so this is the same order: below
 * the smallest mark a player would read as a row's state, and far above the
 * handful of pixels anti-aliasing can move.
 */
const MIN_DISTINCT_PIXELS = 64;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** One baseline the frame drew text on, and the runs on it read left to right. */
interface Line {
  y: number;
  text: string;
}

/** The frame's text runs gathered into the baselines they were drawn on. */
function linesOf(draws: readonly TextDraw[]): Line[] {
  const baselines = new Map<number, TextDraw[]>();
  for (const draw of draws) {
    const on = baselines.get(draw.y) ?? [];
    on.push(draw);
    baselines.set(draw.y, on);
  }
  return [...baselines.entries()]
    .map(([y, on]) => ({
      y,
      text: [...on]
        .sort((a, b) => a.x - b.x)
        .map((draw) => draw.text)
        .join(""),
    }))
    .sort((a, b) => a.y - b.y);
}

/** Text with its case and its whitespace dropped. */
function squash(text: string): string {
  return text.toLowerCase().replace(/\s+/gu, "");
}

/** The baseline a challenge's row was drawn on, found by its name. */
function baselineOf(lines: readonly Line[], name: string): number {
  const row = lines.find((line) => squash(line.text).includes(squash(name)));
  assertDefined(
    row,
    `the Extras select screen draws a row carrying ${JSON.stringify(name)}, ` +
      "which is how the row this point reads is found; the lines the frame drew " +
      `are ${JSON.stringify(lines.map((line) => line.text))}`,
  );
  return row?.y ?? 0;
}

/**
 * The closest two of the shelf's row baselines come, which bounds a row's band.
 *
 * Measured over the named rows the frame actually drew rather than over all ten,
 * because whether every name is on the screen is `select-row-shows-its-name`'s
 * point and not this one's: a build that lost one of them is reported there, and
 * still has a row pitch here.
 */
function pitchOf(lines: readonly Line[]): number {
  const rows = EXTRA_NAMES.flatMap((name) => {
    const row = lines.find((line) => squash(line.text).includes(squash(name)));
    return row === undefined ? [] : [row.y];
  }).sort((a, b) => a - b);
  assertGreaterThanOrEqual(
    rows.length,
    2,
    "the shelf draws at least two of its ten named rows, so a row's band can be " +
      "measured against the pitch between them",
  );
  let pitch = Infinity;
  for (let index = 1; index < rows.length; index += 1) {
    pitch = Math.min(pitch, (rows[index] ?? 0) - (rows[index - 1] ?? 0));
  }
  return pitch;
}

/** One pixel of a rectangle, as `[r, g, b, a]`. */
function pixelOf(rect: PixelRect, at: number): Pixel {
  return [
    rect.data[at] as number,
    rect.data[at + 1] as number,
    rect.data[at + 2] as number,
    rect.data[at + 3] as number,
  ];
}

/**
 * How many pixels of two equally shaped rectangles differ WITH HUE REMOVED.
 *
 * The colour comparison of `color.ts` with the colour taken out of it: a pixel
 * differs when its coverage moved, or when it carries paint in both and its
 * LIGHTNESS moved. Two pixels of different hue and equal lightness are the same
 * pixel here, which is exactly the reading this point is about.
 */
function grayscaleDiffering(a: PixelRect, b: PixelRect): number {
  if (a.width !== b.width || a.height !== b.height) return a.width * a.height;
  let differing = 0;
  for (let at = 0; at < a.data.length; at += 4) {
    const alphaA = a.data[at + 3] as number;
    const alphaB = b.data[at + 3] as number;
    if (Math.abs(alphaA - alphaB) > CHANNEL_EPSILON) {
      differing += 1;
      continue;
    }
    if (alphaA === 0 && alphaB === 0) continue;
    const lightA = luminance(rgbOf(pixelOf(a, at)));
    const lightB = luminance(rgbOf(pixelOf(b, at)));
    if (Math.abs(lightA - lightB) > CHANNEL_EPSILON) differing += 1;
  }
  return differing;
}

it("draws a solved row differently in the grayscale projection", async () => {
  await openTitle(h);
  await openSelect(h, "extras");
  await h.debug.setSelectIndex(PINNED_ROW);
  await h.advance(1);

  const lines = linesOf(textDraws(await h.lastCalls()));
  const pitch = pitchOf(lines);
  assertGreaterThan(
    pitch,
    0,
    "the ten rows are drawn on distinct baselines, so a row has a band of its own",
  );
  // A third of the pitch either side of the baseline: a band of the row's own,
  // wide across the whole stage because `specs/` fixes no column for this screen.
  const band = {
    x: 0,
    y: baselineOf(lines, EXTRA_NAMES[SOLVED_INDEX] as string) - pitch / 3,
    w: STAGE_W,
    h: (2 * pitch) / 3,
  };
  const readBand = (): Promise<PixelRect> =>
    h.pixelRect(band.x, band.y, band.w, band.h);

  const unsolved = await readBand();
  const before = await h.snapshot();
  assertDeepEqual(
    before.extras.solved,
    [],
    "the first frame is the row drawn with nothing on the shelf solved",
  );

  await h.debug.setSolved("extras", SOLVED_INDEX, true);
  await h.advance(1);
  await captureStill(h, "grayscale");
  const solved = await readBand();

  const after = await h.snapshot();
  assertDeepEqual(
    after.extras.solved,
    [SOLVED_INDEX],
    "the second frame is the same row drawn with its challenge solved, and " +
      "nothing else on the shelf is",
  );
  assertEqual(
    after.selectIndex,
    before.selectIndex,
    "the highlight did not move between the two frames, so it is not what they " +
      "differ by",
  );
  assertGreaterThan(
    grayscaleDiffering(unsolved, solved),
    MIN_DISTINCT_PIXELS,
    `the row for ${JSON.stringify(EXTRA_NAMES[SOLVED_INDEX] ?? "")} is drawn ` +
      "differently with hue removed, so its solved state carries information a " +
      "player who cannot separate two hues can still read",
  );
});
