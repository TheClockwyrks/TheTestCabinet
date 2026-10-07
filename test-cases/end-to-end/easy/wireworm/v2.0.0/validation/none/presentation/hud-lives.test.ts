// Wireworm — presentation/hud-lives: the HUD shows the lives remaining.
//
// specs/ui.md's HUD table: the lives readout shows "the lives remaining, as a
// row of icons or as a count". specs/board.md puts every readout inside the
// bar's own region, `y` in `[0, HUD_H]` (`[0, 80]`). Lives are what the run has
// left (specs/progression.md), so a player who cannot see how many are left
// cannot tell a safe mistake from a fatal one.
//
// THE FILE ALLOWS TWO SPELLINGS, SO THE POINT READS BOTH.
//
// AS A COUNT. Some run of text inside the bar names the posed figure as a
// standalone number — `2`, `x2`, `LIVES 2` all read as two, and the digits `12`
// do not, which is what the standalone reading is for. A build that groups the
// thousands of a larger count names it just the same. That settles it outright.
//
// AS A ROW OF ICONS. Otherwise the bar is read as a picture, at three counts of
// lives, and what is asked of it is PRESENCE: the bar drew something at one life
// it does not draw at none, and something again at two it does not draw at one.
// That is the whole of "the lives remaining, as a row of icons": the readout
// answers to the figure. Nothing counts the marks, sizes them or says where they
// landed — a mark drawn as one blob, as an outline and a fill, or as a filled
// slot beside an empty one all read the same here, and how the row reads at a
// glance is the reviewer's from the captured still.
//
// THE BUILD SETS ITS OWN FLOOR. A bar carrying an animation of its own moves
// between any two frames, so the control is the SAME bar read twice at the SAME
// lives count: the largest a pixel of it moves across that pair is what the
// build's own drawing costs, and each step of the lives has to move a pixel
// further than that. A build whose bar is still measures a floor of `0` and is
// held to nothing but an actual change. No figure is fixed here.
//
// THE `0` BASELINE IS SAFE TO POSE. specs/progression.md ends a run on "a
// contact takes lives to `0`" — the game over is the contact's, not a state the
// build is free to notice on its own — and `startPlaying` holds the cursor's
// contact test off with nothing on the board to touch it. So the baseline frame
// is the same board with no lives drawn on it.
//
// THE SCORE IS POSED AT `0` AND THE LEVEL AT `1`, so no other readout on the bar
// can carry a standalone `2` and be read as the lives.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { HUD_H, STAGE_W } from "../constants";
import {
  captureStill,
  createHarness,
  startPlaying,
  textDraws,
  type Harness,
  type TextDraw,
} from "../harness";
import { readRect, type Patch } from "./reading";

/** The lives posed: the figure the point decides. */
const POSED_LIVES = 2;

/** The score and level posed beside them, so no other run carries a 2. */
const POSED_SCORE = 0;
const POSED_LEVEL = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

/** Pose the lives, run one frame, and read the HUD bar back off the canvas. */
async function barAtLives(lives: number): Promise<Patch> {
  await h.debug.setLives(lives);
  await h.advance(1);
  assertEqual(
    (await h.snapshot()).lives,
    lives,
    `the posed lives (${lives}) landed`,
  );
  return readRect(h, 0, 0, STAGE_W, HUD_H);
}

/**
 * The largest a single pixel moves between two readings, as a sum over the three
 * channels out of `765`.
 *
 * The reading each step of the lives is held against, and the reading that sets
 * the floor it is held to — both are this one measure, so the check fixes no
 * figure of its own. A bar the build animates moves by however much its own
 * drawing moves it, and a bar it draws still moves by nothing.
 */
function furthestMove(before: Patch, after: Patch): number {
  let furthest = 0;
  for (const [index, pixel] of after.pixels.entries()) {
    const was = before.pixels[index];
    if (was === undefined) continue;
    const moved =
      Math.abs(pixel.r - was.r) +
      Math.abs(pixel.g - was.g) +
      Math.abs(pixel.b - was.b);
    if (moved > furthest) furthest = moved;
  }
  return furthest;
}

/** The separators a build may draw between the digit triples of a figure. */
const GROUP_SEPARATORS = [",", "'", "\u00A0", "\u202F", "\u2009"];

/** The same separators as one character class. */
const GROUP = `[${GROUP_SEPARATORS.join("")}]`;

/**
 * Every conventional drawing of a whole figure: its plain digits, and the same
 * digits grouped in threes by each separator a build may reach for — `1,234`,
 * `1'234`, and the same with a non-breaking or a thin space. An ASCII space is
 * not among them: the bar's runs are read as the build anchored them, and a run
 * reading `40 130` drew the two figures `40` and `130`, not `40130`. A figure of
 * three digits or fewer has exactly one drawing.
 */
function drawingsOf(figure: number): string[] {
  const plain = String(figure);
  const forms = new Set([plain]);
  for (const separator of GROUP_SEPARATORS) {
    forms.add(plain.replace(/\B(?=(\d{3})+(?!\d))/g, separator));
  }
  return [...forms];
}

/**
 * A standalone occurrence of `figure` in a run: not part of a longer number.
 *
 * Every drawing of the figure is looked for, so a build that groups the
 * thousands of a larger one names it as surely as a build that does not, and the
 * digit boundary is held on both sides, so a run showing `150` still does not
 * name `50`.
 *
 * Leading zeros are not part of that boundary. The specification fixes the
 * figure and leaves how it is written to the build, so a readout padded to a
 * fixed width — `000050`, the odometer idiom `padStart` produces — is the
 * figure 50 as surely as `50` is. Any run of zeros standing directly before
 * the figure is absorbed into it, while a non-zero digit there still ends the
 * reading: `000050` shows 50, `150` and `504` do not. A zero run that is
 * itself a group of a larger grouped figure is not padding: `1,050` shows
 * 1050, not 50. That guard falls on the zeros alone, so a figure standing
 * after a separator with no padding before it, the `7` of a `10,7` pair,
 * reads as it did without the padding allowance.
 */
function names(draw: TextDraw, figure: number): boolean {
  return drawingsOf(figure).some((form) =>
    new RegExp(`(?<![0-9])(?:(?<![0-9]${GROUP})0+)?${form}(?![0-9])`).test(
      draw.text,
    ),
  );
}

it("shows two lives on the HUD bar, as a count or as two icons", async () => {
  await startPlaying(h);
  await h.debug.setScore(POSED_SCORE);
  await h.debug.setLevel(POSED_LEVEL);

  // The same bar at the same lives count, read twice: whatever the build's own
  // drawing moves between two frames is the floor each step below has to clear.
  const control = await barAtLives(0);
  const none = await barAtLives(0);
  const one = await barAtLives(1);
  const posed = await barAtLives(POSED_LIVES);
  // The HUD bar carrying two lives.
  await captureStill(h, "hud");

  // As a count: a run of text on the bar naming the figure on its own.
  const onBar = textDraws(await h.frameCalls()).filter(
    (draw) => draw.y >= 0 && draw.y <= HUD_H,
  );
  if (onBar.some((draw) => names(draw, POSED_LIVES))) return;

  // As a row of icons: the bar answers to the figure, at each step of it.
  const floor = furthestMove(control, none);
  const steps = [
    { from: 0, to: 1, moved: furthestMove(none, one) },
    { from: 1, to: POSED_LIVES, moved: furthestMove(one, posed) },
  ];
  for (const step of steps) {
    assertGreaterThan(
      step.moved,
      floor,
      `the HUD bar to draw something at ${step.to} lives it does not draw at ` +
        `${step.from} (specs/ui.md: the lives remaining, as a row of icons or ` +
        `as a count), and no run of its text named ${POSED_LIVES} on its own ` +
        `— the bar's runs were ` +
        `${JSON.stringify(onBar.map((draw) => draw.text))}; the same bar read ` +
        `twice at one lives count moved ${floor} of 765`,
    );
  }
});
