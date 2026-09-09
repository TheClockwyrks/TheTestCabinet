// ui/state-matchover-score — the match-over screen shows the final score.
//
// specs/ui.md: the match-over screen displays the winning side and the final
// score. The match is ended for real, so the figures the screen shows are the
// ones the build's own scoring left behind rather than any this check assigned:
// the score is posed at 10-0 as a precondition and a ball is then driven out of
// the right goal, so the eleventh point, and the win rule that resolves on it
// (first to WIN_SCORE, by at least WIN_LEAD), run through the build's own code.
//
// `arrangeGoal` empties the field and spawns back the one ball it drives, so a
// scored point is that ball and the goal edge and nothing else: both obstacles
// come OFF the field rather than being reasoned around, and the paddles are
// stood out of the lane. The shot meets nothing on its way in any variant.
//
// The final score is read as the two numbers drawn: `11` somewhere in the
// frame's text, and `0` as a number of its own. How the screen presents them —
// side by side, labelled, on two lines — is the build's. The text is the LOGICAL
// runs the frame spelled (`drawnTextLines`) AND the raw `fillText` strings
// (`drawnText`) together: a build that letter-spaces the score draws `1`, `1`
// as two calls, and only the coalesced run spells `11`, while `figure` is
// bounded on a digit either side, so a label's own digit coalescing onto the
// score (`P1` then `11` a few units on, read as `P111`) would lose a boundary
// the raw string still has. The union reads both, so neither presentation is
// fed back as a failure.
//
// SPLIT FROM `ui/state-matchover`, which reads the two menu entries. A build
// that offers the entries but tells the player nothing about how the match ended
// is not the same build as one that shows neither, and a match-over screen
// missing its figures still gets the player back to a match, so this half is the
// cheaper miss.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertMatches } from "../assert";
import { WIN_SCORE } from "../constants";
import {
  arrangeGoal,
  captureStill,
  createHarness,
  drawnText,
  drawnTextLines,
  driveGoal,
  startPlaying,
  type Harness,
} from "../harness";

/**
 * Group separators a build may draw between a figure's digit triples.
 *
 * An ASCII space is deliberately absent. The frame's separate runs of text are
 * joined with one, so accepting it would read the two figures in `40 130` as the
 * single figure `40130`. `.` is absent for the same kind of reason: it is the
 * decimal point, and a build drawing `1.5` means one and a half.
 */
const GROUP = [",", "'", "\u00A0", "\u202F", "\u2009"];

/**
 * A pattern matching `value` drawn as a figure of its own.
 *
 * specs/ui.md fixes the two figures the screen carries and leaves how they are
 * drawn to the build, so every conventional rendering of the figure is accepted
 * and a grouped figure reads as the one figure it is: `1234`, `1,234`, `1'234`,
 * and the three space separators a locale reaches for (U+00A0, U+202F, U+2009) —
 * which is what `toLocaleString` draws by default. A figure of three digits or
 * fewer has exactly one rendering, so a final score short of a thousand is the
 * bare digits it is. The digit boundary either side is what keeps a screen
 * showing `150` from reading as one showing `50`.
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
function figure(value: number): RegExp {
  const plain = String(value);
  const forms = new Set([
    plain,
    ...GROUP.map((sep) => plain.replace(/\B(?=(\d{3})+(?!\d))/g, sep)),
  ]);
  const alternatives = [...forms]
    .map((form) => form.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
  const group = `[${GROUP.join("")}]`;
  return new RegExp(
    `(?<![\\d.])(?:(?<!\\d${group})0+)?(?:${alternatives})(?![\\d.])`,
  );
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws the final score the match ended on", async () => {
  await startPlaying(h, "versus");
  await h.debug.setScore(WIN_SCORE - 1, 0);
  await arrangeGoal(h, "right");

  const ended = await driveGoal(h);
  assertEqual(ended.hit, true);

  const over = await h.snapshot();
  assertEqual(over.screen, "matchover");
  assertDeepEqual(over.score, { p1: WIN_SCORE, p2: 0 });

  const calls = await h.frameCalls();
  await captureStill(h, "score");
  const text = [...drawnText(calls), ...drawnTextLines(calls)].join(" ");
  assertMatches(text, figure(WIN_SCORE));
  assertMatches(text, figure(0));
});
