// presentation/hud-score-is-drawn — the running score is drawn, and drawn where the
// HUD belongs.
//
// THE RULE. `specs/ui.md`: "The HUD is drawn over the `playing` screen, in the upper
// portion of the field and clear of the field's centre", and its first readout is
// the "Score | The running score, as digits, at the top left. It is the most
// prominent of the readouts." `specs/overview.md` repeats the placement from the
// player's side: "The score and the ships in reserve are each legible at the logical
// field size, and nothing of the HUD is drawn over the field's centre."
//
// TWO DIRECTIONS OF THE ONE RULE, IN ORDER. First that the score is drawn AS DIGITS
// at all — a run of text on the frame whose digits are the score the game is
// carrying — and then that it is drawn WHERE the HUD belongs. A build that draws the
// score across the middle of the field fails the second and passes the first, and a
// build that draws no score fails the first, so the two failures do not look alike.
//
// WHAT IS READ. The runs of text the frame drew, each placed in logical field units
// through the transform in force at the call, the width it measured under the font
// then set, and the alignment that placed it about its anchor (`textRuns`, `ink.ts`).
// Nothing about the type is asserted: `specs/overview.md` leaves the palette and the
// typography to the build, so what is required is a run whose DIGITS read as the
// score. A label around them (`SCORE 4870`) and a padded figure (`04870`) both read
// as the score and both pass; another readout's digits do not.
//
// WHERE THE HUD MAY BE. The upper half of the field (`HUD_REGION`), and clear of the
// star's whole drawn extent — `1.5 x HALO_R` (`180`), the one distance
// `specs/field.md` fixes about the middle of the field and therefore the figure
// "clear of the field's centre" is read against.
//
// THE POSE. An emptied, gated field on the `playing` screen, so the only readout on
// the frame is the HUD's own and no banner, rock or saucer can put digits anywhere.
// The score is posed to `4870`, which no other figure this scenario carries — a wave
// of `1`, three ships, an empty field — could be mistaken for.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan } from "../assert";
import { STAR } from "../geometry";
import {
  captureStill,
  clearCalls,
  createHarness,
  startPlaying,
  type Harness,
} from "../harness";
import { textRuns, type TextRun } from "./ink";
import { HUD_REGION, STAR_DRAW_R } from "./scene";

/**
 * The score the HUD is posed to carry.
 *
 * Four digits, none of them repeated, and unlike every other figure on the frame:
 * `startPlaying` opens at wave `1` with three ships on an empty field, so nothing
 * else the build could draw parses to this.
 */
const SCORE = 4870;

/** The digits of a drawn run, as the number they read as; `NaN` for a run with none. */
function digitsOf(run: TextRun): number {
  return Number.parseInt(run.text.replace(/\D/g, ""), 10);
}

/** How far a run's box sits from the star's centre at its nearest corner. */
function nearestToStar(run: TextRun): number {
  const x = Math.min(Math.max(STAR.x, run.left), run.right);
  const y = Math.min(Math.max(STAR.y, run.top), run.bottom);
  return Math.hypot(x - STAR.x, y - STAR.y);
}

/** Whether a run's whole box lies in the upper portion the HUD is drawn in. */
function inTheUpperPortion(run: TextRun): boolean {
  return run.top >= HUD_REGION.y && run.bottom <= HUD_REGION.y + HUD_REGION.h;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws the score's digits in the upper portion of the field, clear of the star", async () => {
  startPlaying(h);
  h.debug.setScore(SCORE);
  clearCalls(h);
  await h.advance(1);

  const runs = textRuns(h);
  captureStill(h, "hud");

  const drawn = runs.filter((run) => digitsOf(run) === SCORE);
  assertGreaterThan(
    drawn.length,
    0,
    "how many runs of text the frame drew whose digits read as the posed " +
      `score of ${String(SCORE)}, which the HUD shows as digits (specs/ui.md)`,
  );

  const placed = drawn.filter(
    (run) => inTheUpperPortion(run) && nearestToStar(run) > STAR_DRAW_R,
  );
  assertGreaterThan(
    placed.length,
    0,
    `of the ${String(drawn.length)} runs drawing the score, how many are ` +
      "drawn wholly in the upper half of the field and further than " +
      `${String(STAR_DRAW_R)} from the field's centre, where the HUD belongs ` +
      "(specs/ui.md)",
  );
});
