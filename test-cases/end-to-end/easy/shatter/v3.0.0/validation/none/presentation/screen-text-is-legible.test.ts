// presentation/screen-text-is-legible — every screen's text reads against whatever
// the build put behind it.
//
// THE RULE. `specs/ui.md` opens with it: "Every piece of text a screen shows is
// legible against whatever sits behind it at the logical field size, `1280 x 720`."
// `specs/overview.md` says the same of the whole build: "Every readout and every
// screen's text is legible against its background at the logical field size." The
// screens are where the game is explained, paused and ended, and a build that draws
// its menu in a colour a shade off its own panel has a game nobody can navigate.
//
// ALL FIVE SCREENS, IN ONE CHECK, because the manifest declares one item over the
// five and a failure names which of them it read (`specs/ui.md`: the game is on
// exactly one of `title`, `howto`, `playing`, `paused` and `gameover` at a time).
// Each is reached through the debug surface and read as it stands, with the score and
// the wave posed on the two screens that show them so there is something to read.
//
// WHAT IS MEASURED, AND WHY IT IS A SPREAD RATHER THAN TWO COLOURS. Nothing here
// knows which pixels are ink: `specs/overview.md` leaves the palette and the type to
// the build, so a build may set light text on a dark plate or dark text on a light
// one, and either is legible. So each run of text is sampled across its own measured
// box — five rows through it and every couple of units along it, which catches the
// glyphs and the ground between and around them whichever way up the build's
// baseline is — and what is asserted is the SPREAD of those samples: the distance
// between the reading a twentieth of the way up the sample's brightness and the
// reading a twentieth from the top. Ink against its own immediate background is
// exactly that spread; a run drawn a shade off its background has none whichever
// colour is which.
//
// THE TWENTIETHS RATHER THAN THE EXTREMES, so a single anti-aliased pixel or one
// stray bright mark behind the run cannot carry it, and low enough that a run whose
// glyphs cover only a twentieth of its own box still reads.
//
// THE BOUND IS THE ITEM'S: eighty of the 441 an RGB distance can span. Higher than
// the sixty this group uses to tell a BODY from the field, because text is thin —
// a body is read at a glance from its mass and a glyph from its edges — and
// `specs/ui.md` asks for legibility rather than mere presence.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertTrue } from "../assert";
import { FIELD_H, FIELD_W, type Screen } from "../constants";
import {
  captureStill,
  colorDistance,
  createHarness,
  luminance,
  startPlaying,
  textDraws,
  type Harness,
  type Rgb,
  type TextDraw,
} from "../harness";
import { readPoints } from "./ink";

/** How far the text must read from what is immediately around it, of 441. The item's figure. */
const LEGIBLE = 80;

/** The rows through a run that are sampled, as offsets from its anchor. */
const ROWS = [-6, -3, 0, 3, 6] as const;

/** How far apart two samples along a run are, in logical units. */
const ALONG_STEP = 2;

/** How far either side of an unmeasured run's anchor to sample, in logical units. */
const UNMEASURED_HALF_WIDTH = 30;

/** Which twentieths of the sorted samples the spread is taken between. */
const LOW_FRACTION = 0.05;
const HIGH_FRACTION = 0.95;

/** The fewest samples a run must yield before its spread is read. */
const MIN_SAMPLES = 12;

/** The score posed on the screens that show one. */
const SCORE = 730;

/** The wave posed on the screen that shows one. */
const WAVE = 4;

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

/** Put the game on `screen`, with whatever that screen needs to have text on it. */
async function pose(h: Harness, screen: Screen): Promise<void> {
  if (screen === "title" || screen === "howto") {
    await h.debug.reset();
    await h.debug.setScreen(screen);
    await h.debug.setMenuIndex(0);
    return;
  }
  await startPlaying(h);
  await h.debug.setScore(SCORE);
  await h.debug.setWave(WAVE);
  if (screen !== "playing") {
    await h.debug.setScreen(screen);
    await h.debug.setMenuIndex(0);
  }
}

/** The points one run of text is read at: five rows through its own measured box. */
function runPoints(run: TextDraw): { x: number; y: number }[] {
  const measured = run.right > run.left;
  const from = measured ? run.left : run.x - UNMEASURED_HALF_WIDTH;
  const to = measured ? run.right : run.x + UNMEASURED_HALF_WIDTH;
  const points: { x: number; y: number }[] = [];
  for (const row of ROWS) {
    const y = run.y + row;
    if (y < 0 || y > FIELD_H - 1) continue;
    for (let x = from; x <= to; x += ALONG_STEP) {
      if (x < 0 || x > FIELD_W - 1) continue;
      points.push({ x, y });
    }
  }
  return points;
}

/** The distance between the low and high twentieths of a set of readings, of 441. */
function spread(look: readonly Rgb[]): number {
  const sorted = [...look].sort((a, b) => luminance(a) - luminance(b));
  const at = (fraction: number): Rgb =>
    sorted[
      Math.min(
        sorted.length - 1,
        Math.max(0, Math.round(fraction * (sorted.length - 1))),
      )
    ];
  return colorDistance(at(LOW_FRACTION), at(HIGH_FRACTION));
}

it("draws every screen's text apart from the pixels immediately around it", async () => {
  const screens: Screen[] = ["title", "howto", "playing", "paused", "gameover"];

  for (const screen of screens) {
    await pose(harness, screen);
    const runs = textDraws(await harness.presentCalls()).filter(
      (run) => run.text.trim() !== "",
    );
    // Overwritten each time round, so what is kept is the last screen that RAN,
    // including the one an assertion below is about to fail on.
    await captureStill(harness, "screens");

    assertTrue(
      runs.length > 0,
      `the ${screen} screen drawing some text at all (specs/ui.md)`,
    );

    for (const run of runs) {
      const points = runPoints(run);
      if (points.length < MIN_SAMPLES) continue;
      assertGreaterThan(
        spread(await readPoints(harness, points)),
        LEGIBLE,
        `${screen}: the distance out of 441 across the drawn run ${JSON.stringify(run.text)} between what it is drawn in and what is immediately around it (specs/ui.md)`,
      );
    }
  }
});
