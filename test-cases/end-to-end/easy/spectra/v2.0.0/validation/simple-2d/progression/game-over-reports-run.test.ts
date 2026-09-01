// progression/game-over-reports-run — the game-over screen reports the run.
//
// specs/ui.md, of `gameOver`: "Opened when the last life is lost. It draws the
// run's final score and the stage it reached." specs/progression.md closes with
// the same sentence.
//
// SO THE MEASUREMENT IS TWO NUMBERS THE SCREEN ITSELF DREW. The run is posed at a
// score and a stage neither of which the game arrives at on its own — `0`, `1`,
// `EXTRA_LIFE_AT` and the figures of specs/scoring.md are all somewhere else —
// the screen is opened, ONE frame is rendered, and every run of text that frame
// drew is read back with the place it was drawn at.
//
// WHY THE POSITION IS PART OF THE READING, AND WHERE THE LINE IS DRAWN. The score
// and the stage are ALREADY on the screen without this report: specs/field.md
// puts both readouts in the top HUD strip, `y` in `[0, HUD_TOP_H]` (`[0, 64]`),
// and a build is free to keep drawing the strips under whatever the current
// screen lays over them. A check that only asked "did the frame draw 24680
// somewhere" would therefore be answered by the HUD on every build ever written,
// including one whose game-over screen reports nothing at all — it would grade
// nothing. So each number is required to appear in a run of text drawn BELOW the
// top strip, which is the one place specs/field.md says the score readout and the
// stage readout are not. Nothing narrower is asserted: the bottom strip is
// allowed, since specs/field.md gives it the lives, the meter, the polarity
// indicator and the mute indicator and never the score or the stage, and how the
// screen is laid out, in what words, and at what size are all the build's
// (specs/ui.md: "The palette, the type, and the layout of each screen are
// yours").
//
// THE TWO POSED FIGURES CANNOT BE CONFUSED WITH EACH OTHER. `24680` contains no
// `7`, so the stage's digit cannot be found inside the score's run.
//
// WHAT IS READ, AND HOW LENIENTLY. `fillText` and `strokeText`, which is every
// string a canvas build can draw, with the digits matched as a standalone number
// so a screen reading "STAGE REACHED 7" is accepted and one reading "1975" is
// not. Leading zeros and thousands separators are allowed, since specs/ui.md
// fixes the score as digits and leaves their grouping to the build.
//
// THE SCREEN IS POSED RATHER THAN REACHED. That the last life opens it is
// `progression.game-over-at-zero`'s, so a build with a broken last-life path
// fails that point alone and is still graded here on what its game-over screen
// draws.

import { afterEach, beforeEach, it } from "vitest";
import { HUD_TOP_H } from "../../src/constants";
import { assertEqual, assertTrue } from "../assert";
import {
  createHarness,
  captureStill,
  drawFrame,
  drawnTextSpans,
  startPosed,
  type Harness,
  type TextSpan,
} from "../harness";

/**
 * The score the run is posed at.
 *
 * Five digits, none of them the stage's, and nothing the game reaches by
 * accident: not `0`, not `EXTRA_LIFE_AT` (`20000`), and not a sum of the figures
 * specs/scoring.md fixes that a posed run would be sitting on.
 */
const POSED_SCORE = 24680;

/**
 * The stage the run is posed at.
 *
 * Not `1`, which is where every run begins and what a build reporting a fresh run
 * would draw; not a multiple of `CHALLENGE_EVERY` (`3`), so no challenge banner
 * is involved; and a digit that appears nowhere inside `POSED_SCORE`.
 */
const POSED_STAGE = 7;

/**
 * The `y` below which a run of text is not one of the two HUD readouts, in
 * logical stage units.
 *
 * `HUD_TOP_H` (`64`) is the bottom of the top HUD strip, and specs/field.md puts
 * the score readout and the stage readout inside it. This is that boundary
 * exactly rather than a margin: a report drawn one unit below the strip is
 * already outside it, and widening the exclusion would start demanding a layout
 * the specification leaves to the build.
 */
const BELOW_HUD = HUD_TOP_H;

/**
 * The characters a build may group a run of digits with, dropped before the
 * match.
 *
 * A comma and the three spaces a locale groups thousands with. specs/ui.md fixes
 * the score as digits and says nothing about how they are grouped, so `24,680`
 * and `24 680` report the run exactly as `24680` does.
 */
const GROUPERS = /[,\u00a0\u202f\u2009]/g;

/** Whether a span drew `value` as a standalone number below the top HUD strip. */
function reported(spans: readonly TextSpan[], value: number): boolean {
  const pattern = new RegExp(`(^|[^0-9])0*${value}([^0-9]|$)`);
  return spans.some(
    (span) =>
      span.y > BELOW_HUD && pattern.test(span.text.replace(GROUPERS, "")),
  );
}

/** Every run of text drawn below the top strip, for a failure to name. */
function belowHud(spans: readonly TextSpan[]): string[] {
  return spans.filter((span) => span.y > BELOW_HUD).map((span) => span.text);
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws the run's final score and the stage it reached", async () => {
  startPosed(h);
  h.debug.setStage(POSED_STAGE);
  h.debug.setScore(POSED_SCORE);
  h.debug.setScreen("gameOver");

  const posed = h.snapshot();
  assertEqual(posed.score, POSED_SCORE, "the score the run was posed at");
  assertEqual(posed.stage, POSED_STAGE, "the stage the run was posed at");
  assertEqual(posed.screen, "gameOver", "the screen the run was posed on");

  const spans = drawnTextSpans(h, await drawFrame(h));
  captureStill(h, "report");

  assertTrue(
    reported(spans, POSED_SCORE),
    `the game-over screen drawing the run's final score, ${POSED_SCORE}, in a ` +
      `run of text below the top HUD strip (y > ${BELOW_HUD}), where ` +
      "specs/field.md says the HUD's own score readout does not sit — it drew " +
      `${JSON.stringify(belowHud(spans))} there (specs/ui.md: gameOver draws ` +
      "the run's final score)",
  );
  assertTrue(
    reported(spans, POSED_STAGE),
    `the game-over screen drawing the stage the run reached, ${POSED_STAGE}, ` +
      `in a run of text below the top HUD strip (y > ${BELOW_HUD}), where ` +
      "specs/field.md says the HUD's own stage readout does not sit — it drew " +
      `${JSON.stringify(belowHud(spans))} there (specs/ui.md: gameOver draws ` +
      "the stage it reached)",
  );
});
