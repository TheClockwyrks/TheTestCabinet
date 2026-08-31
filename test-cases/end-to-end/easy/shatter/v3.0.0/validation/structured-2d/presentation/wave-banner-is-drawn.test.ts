// presentation/wave-banner-is-drawn — the banner names the wave while it runs, and
// nothing of it is drawn once it has run out.
//
// THE RULE. `specs/ui.md`: "The `WAVE N` banner is drawn centred on the field while
// it runs, naming the wave about to start, as `specs/progression.md` states. It is
// not part of the persistent HUD, and nothing of it is drawn once the banner has run
// out." `specs/progression.md` gives the window its length, `WAVE_BANNER_TIME`
// (`1.5` seconds). It is the one thing that tells a player a wave was cleared and
// which one is coming.
//
// TWO DIRECTIONS OF THE ONE RULE. That it is there while the timer is up, and that
// it is gone when the timer is down. A build that never draws a banner and a build
// that leaves one on the field for the rest of the game are different faults, and
// the failure says which.
//
// WHAT IS READ. The runs of text the frame drew, each placed in logical field units
// (`textRuns`, `ink.ts`), and what is required of one is that its DIGITS name the
// wave and that it sits near the middle of the field. Nothing about the copy, the
// type or the size is asserted beyond that: `specs/overview.md` leaves the typography
// to the build, and the `screens` group is where a screen's fixed copy is graded.
//
// WHY THE READING IS CONFINED TO THE MIDDLE OF THE FIELD. `specs/ui.md` welcomes "a
// further readout of your own" on the HUD, so a build that keeps a permanent wave
// counter in its corner is conformant — and a check that looked anywhere on the frame
// would read that counter as a banner, pass the first half for the wrong reason and
// fail the second half of a build that did nothing wrong. The banner is the one the
// specification draws "centred on the field", so only the middle of the field is read.
//
// THE POSE. An emptied, gated field on the `playing` screen. The banner is posed with
// `setWaveBanner`, which sets the timer alone, and the wave with `setWave`, which
// "spawns nothing" (`specs/instrumentation.md`); the wave loop is shut, so no banner
// the game raised of its own can be confused for the posed one and no rock arrives as
// this one ends. The wave is posed to `7`, which no other figure on the frame — a
// score of `0`, three ships — reads as.

import { afterEach, beforeEach, it } from "vitest";
import { FIELD_H, FIELD_W, WAVE_BANNER_TIME } from "../../src/constants";
import { assertEqual, assertGreaterThan } from "../assert";
import {
  captureStill,
  clearCalls,
  createHarness,
  startPlaying,
  type Harness,
} from "../harness";
import { textRuns, type TextRun } from "./ink";

/** The wave the banner is posed to name. Distinct from every other figure drawn. */
const WAVE = 7;

/** The middle of the field, which `specs/ui.md` centres the banner on. */
const CENTRE = { x: FIELD_W / 2, y: FIELD_H / 2 } as const;

/**
 * How far from the field's centre a run may sit and still be the banner, in logical
 * units.
 *
 * `160`, measured from the centre of the run's own box. `specs/ui.md` draws the
 * banner "centred on the field" without fixing a placement to the unit, so this
 * admits a build that sets its banner a little above or below the middle while
 * excluding the corners the HUD is drawn in — the nearest of which is more than `600`
 * away.
 */
const NEAR_THE_CENTRE = 160;

/** The digits of a drawn run, as the number they read as; `NaN` for a run with none. */
function digitsOf(run: TextRun): number {
  return Number.parseInt(run.text.replace(/\D/g, ""), 10);
}

/** Whether a run is drawn near the middle of the field, by its box's centre. */
function nearTheCentre(run: TextRun): boolean {
  return (
    Math.hypot(
      (run.left + run.right) / 2 - CENTRE.x,
      (run.top + run.bottom) / 2 - CENTRE.y,
    ) <= NEAR_THE_CENTRE
  );
}

/** The runs drawn near the middle of the field naming the wave. */
function banners(harness: Harness): TextRun[] {
  return textRuns(harness).filter(
    (run) => nearTheCentre(run) && digitsOf(run) === WAVE,
  );
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws text naming the wave near the field's centre while the banner runs, and none once it is out", async () => {
  startPlaying(h);
  h.debug.setWave(WAVE);
  h.debug.setWaveBanner(WAVE_BANNER_TIME);
  clearCalls(h);
  await h.advance(1);
  captureStill(h, "banner");

  assertGreaterThan(
    banners(h).length,
    0,
    `how many runs of text naming wave ${String(WAVE)} the frame drew within ` +
      `${String(NEAR_THE_CENTRE)} of the field's centre while the banner was ` +
      "running (specs/ui.md)",
  );

  h.debug.setWaveBanner(0);
  clearCalls(h);
  await h.advance(1);

  assertEqual(
    banners(h).length,
    0,
    `how many runs of text naming wave ${String(WAVE)} the frame drew within ` +
      `${String(NEAR_THE_CENTRE)} of the field's centre once the banner had ` +
      "run out, where nothing of it may still be drawn (specs/ui.md)",
  );
});
