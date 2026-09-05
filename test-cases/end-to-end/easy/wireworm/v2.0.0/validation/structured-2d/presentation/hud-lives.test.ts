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
import { HUD_H, STAGE_W } from "../constants";
import { assertEqual, assertGreaterThan } from "../assert";
import {
  captureStill,
  createHarness,
  drawnTextSpans,
  resetTo,
  startPlaying,
  type Harness,
  type TextSpan,
} from "../harness";

/** The lives posed: the figure the point decides. */
const POSED_LIVES = 2;

/** The score and level posed beside them, so no other run carries a 2. */
const POSED_SCORE = 0;
const POSED_LEVEL = 1;

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
  for (const separator of [",", "'", "\u00A0", "\u202F", "\u2009"]) {
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
 */
function names(span: TextSpan, figure: number): boolean {
  return drawingsOf(figure).some((form) =>
    new RegExp(`(?<![0-9])${form}(?![0-9])`).test(span.text),
  );
}

/** One rendered frame's HUD bar, as raw device pixels. */
interface Bar {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

/** Pose the lives, run one frame, and read the HUD bar back off the canvas. */
async function barAtLives(lives: number): Promise<Bar> {
  h.debug.setLives(lives);
  h.calls.length = 0;
  await h.advance(1);
  assertEqual(h.snapshot().lives, lives, `the posed lives (${lives}) landed`);
  const corner = h.device(0, 0);
  const far = h.device(STAGE_W, HUD_H);
  const width = far.x - corner.x;
  const height = far.y - corner.y;
  const { data } = h.ctx.getImageData(corner.x, corner.y, width, height);
  return { data, width, height };
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
function furthestMove(before: Bar, after: Bar): number {
  let furthest = 0;
  const length = Math.min(before.data.length, after.data.length);
  for (let at = 0; at + 2 < length; at += 4) {
    const moved =
      Math.abs(after.data[at] - before.data[at]) +
      Math.abs(after.data[at + 1] - before.data[at + 1]) +
      Math.abs(after.data[at + 2] - before.data[at + 2]);
    if (moved > furthest) furthest = moved;
  }
  return furthest;
}

it("shows two lives on the HUD bar, as a count or as two icons", async () => {
  resetTo(h);
  startPlaying(h);
  h.debug.setScore(POSED_SCORE);
  h.debug.setLevel(POSED_LEVEL);

  // The same bar at the same lives count, read twice: whatever the build's own
  // drawing moves between two frames is the floor each step below has to clear.
  const control = await barAtLives(0);
  const none = await barAtLives(0);
  const one = await barAtLives(1);
  const posed = await barAtLives(POSED_LIVES);
  // The HUD bar carrying two lives.
  captureStill(h, "hud");

  // As a count: a run of text on the bar naming the figure on its own.
  const onBar = drawnTextSpans(h).filter(
    (span) => span.y >= 0 && span.y <= HUD_H,
  );
  const counted = onBar.filter((span) => names(span, POSED_LIVES));
  if (counted.length > 0) return;

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
        `${JSON.stringify(onBar.map((span) => span.text))}; the same bar read ` +
        `twice at one lives count moved ${floor} of 765`,
    );
  }
});
