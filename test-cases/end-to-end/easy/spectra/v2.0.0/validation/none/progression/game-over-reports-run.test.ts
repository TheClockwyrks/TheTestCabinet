// progression/game-over-reports-run — the game-over screen reports the run.
//
// `specs/ui.md`, of `gameOver`: "Opened when the last life is lost. It draws the
// run's final score and the stage it reached." `specs/progression.md` closes with
// the same sentence.
//
// SO THE MEASUREMENT IS TWO NUMBERS THE SCREEN ITSELF DREW. The run is posed at a
// score and a stage neither of which the game arrives at on its own — `0`, `1`,
// `EXTRA_LIFE_AT` and the figures of `specs/scoring.md` are all somewhere else —
// the screen is opened, one frame is rendered, and every run of text that frame
// drew is read back with the position it was drawn at.
//
// WHY THE POSITION IS PART OF THE READING, AND WHERE THE LINE IS DRAWN. The score
// and the stage are ALREADY on the screen without this report: `specs/field.md`
// puts both readouts in the top HUD strip, `y` in `[0, HUD_TOP_H]` (`[0, 64]`),
// and a build is free to keep drawing the strips under whatever the current
// screen lays over them. A check that only asked "did the frame draw 24680
// somewhere" would therefore be answered by the HUD on every build ever written,
// including one whose game-over screen reports nothing at all — it would grade
// nothing. So each number is required to appear in a run of text drawn BELOW the
// top strip, which is the one place `specs/field.md` says the score readout and
// the stage readout are not. Nothing narrower is asserted: the bottom strip is
// allowed, since `specs/field.md` gives it the lives, the meter, the polarity
// indicator and the mute indicator and never the score or the stage, and how the
// screen is laid out, in what words, and at what size are all the build's
// (`specs/ui.md`: "The palette, the type, and the layout of each screen are
// yours").
//
// THE TWO POSED FIGURES CANNOT BE CONFUSED WITH EACH OTHER. `24680` contains no
// `7`, so the stage's digit cannot be found inside the score's run.
//
// WHAT IS READ, AND HOW LENIENTLY. `fillText` and `strokeText`, which is every
// string a canvas build can draw, with the digits matched as a standalone number
// so a screen reading "STAGE REACHED 7" is accepted and one reading "1975" is
// not. Leading zeros and thousands separators are allowed, since `specs/ui.md`
// fixes the score as "digits" and leaves their grouping to the build.
//
// WHAT THIS DOES NOT DECIDE. That the last life opens the screen at all, which is
// `progression/game-over-at-zero`'s — the screen is posed here so that a build
// with a broken last-life path fails that item alone. Nor what the screen's two
// menu items say or do, which is `screens/`'s.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertTrue } from "../assert";
import { HUD_TOP_H } from "../constants";
import {
  captureStill,
  createHarness,
  startPosed,
  textDraws,
  type DrawCall,
  type Harness,
} from "../harness";

/**
 * The score the run is posed at.
 *
 * Five digits, none of them the stage's, and nothing the game reaches by
 * accident: not `0`, not `EXTRA_LIFE_AT` (`20000`), and not a sum of the figures
 * `specs/scoring.md` fixes that a posed run would be sitting on.
 */
const POSED_SCORE = 24680;

/**
 * The stage the run is posed at.
 *
 * Not `1`, which is where every run begins and what a build reporting a fresh run
 * would draw; not a multiple of `CHALLENGE_EVERY` (`3`), so no challenge banner is
 * involved; and a digit that appears nowhere inside `POSED_SCORE`.
 */
const POSED_STAGE = 7;

/**
 * The `y` below which a run of text is not one of the two HUD readouts, in
 * logical stage units.
 *
 * `HUD_TOP_H` (`64`) is the bottom of the top HUD strip, and `specs/field.md`
 * puts the score readout and the stage readout inside it. This is that boundary
 * exactly rather than a margin: a report drawn one unit below the strip is
 * already outside it, and widening the exclusion would start demanding a layout
 * the specification leaves to the build.
 */
const BELOW_HUD = HUD_TOP_H;

/**
 * The characters a build may group a run of digits with.
 *
 * A comma, an apostrophe and the three spaces a locale groups thousands by —
 * between them every separator `Number.prototype.toLocaleString` reaches for. The
 * ASCII space is deliberately absent: a plain space is what stands between two
 * figures in one run of text, so accepting it would read the two figures of
 * `40 130` as the single number `40130`. The full stop is absent for a reason of
 * its own — it is the decimal point.
 */
const GROUPERS = [",", "'", "\u00A0", "\u202F", "\u2009"] as const;

/** The characters a regular expression would otherwise read as syntax. */
function quoted(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Every conventional rendering of `value`: plain, and grouped in threes by each
 * separator above.
 *
 * `24680` renders as `24680`, `24,680`, `24'680` and the three spaced forms.
 * specs/ui.md fixes the score as digits and says nothing about how they are
 * grouped, so every one of those reports the run exactly as the plain figure
 * does. A value of three digits or fewer — the stage — has exactly one rendering.
 */
function renderings(value: number): string[] {
  const plain = String(value);
  const point = plain.indexOf(".");
  const whole = point === -1 ? plain : plain.slice(0, point);
  const rest = point === -1 ? "" : plain.slice(point);
  const sign = whole.startsWith("-") ? "-" : "";
  const digits = sign === "" ? whole : whole.slice(1);
  if (digits.length <= 3) return [plain];
  const triples = digits.match(/\d{1,3}(?=(?:\d{3})*$)/g) ?? [digits];
  return [plain, ...GROUPERS.map((by) => `${sign}${triples.join(by)}${rest}`)];
}

/**
 * Whether the frame drew `value` as a standalone number below the top HUD strip.
 *
 * Leading zeros are allowed, because a build is free to pad a readout, and every
 * grouped rendering counts, because `specs/ui.md` fixes the score as digits and
 * leaves how they are grouped to the build. Everything else is required: the
 * figure must not have a digit or a decimal point against either end of it, so a
 * screen reading `1975` does not report a stage of `7`.
 */
function reported(calls: readonly DrawCall[], value: number): boolean {
  const patterns = renderings(value).map(
    (rendering) => new RegExp(`(?<![\\d.])0*${quoted(rendering)}(?![\\d.])`),
  );
  return textDraws(calls).some(
    (draw) =>
      draw.y > BELOW_HUD && patterns.some((pattern) => pattern.test(draw.text)),
  );
}

/** Every run of text the frame drew below the top HUD strip, for a failure to name. */
function belowHud(calls: readonly DrawCall[]): string[] {
  return textDraws(calls)
    .filter((draw) => draw.y > BELOW_HUD)
    .map((draw) => draw.text);
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws the run's final score and the stage it reached", async () => {
  await startPosed(h, { stage: POSED_STAGE });
  await h.debug.setScore(POSED_SCORE);
  await h.debug.setScreen("gameOver");

  const posed = await h.snapshot();
  assertEqual(posed.score, POSED_SCORE, "the score the run was posed at");
  assertEqual(posed.stage, POSED_STAGE, "the stage the run was posed at");
  assertEqual(posed.screen, "gameOver", "the screen the run was posed on");

  const calls = await h.frameCalls();
  await captureStill(h, "report");

  assertTrue(
    reported(calls, POSED_SCORE),
    `the game-over screen drawing the run's final score, ${String(POSED_SCORE)}, ` +
      `below the top HUD strip (y > ${String(BELOW_HUD)}) where the HUD's own ` +
      `score readout does not sit — it drew ${JSON.stringify(belowHud(calls))} ` +
      "there (specs/ui.md, specs/field.md)",
  );
  assertTrue(
    reported(calls, POSED_STAGE),
    `the game-over screen drawing the stage the run reached, ${String(POSED_STAGE)}, ` +
      `below the top HUD strip (y > ${String(BELOW_HUD)}) where the HUD's own ` +
      `stage readout does not sit — it drew ${JSON.stringify(belowHud(calls))} ` +
      "there (specs/ui.md, specs/field.md)",
  );
});
