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
// And how much of the middle is what `specs/ui.md` leaves open: it fixes no placement
// to the unit, leaves "the layout of each screen" to the build, requires every piece
// of text to be legible against what sits behind it, and `specs/field.md` puts the
// star at the field's exact centre, drawn out to `180`. So "centred on the field" is
// read as the field's central region rather than as a point — the middle half of its
// width and the middle two thirds of its height — which admits a banner set across the
// middle, one lifted clear of the star's halo, and one stacked over two lines, while
// still excluding the corners the HUD is drawn in.
//
// AND WHAT NAMES THE WAVE IN THAT REGION IS READ AGAINST THE FRAME BEFORE THE BANNER.
// A build is free to keep a readout of its own inside the region too, so a run naming
// the wave is the banner only if it is there while the banner runs and not before:
// the region's wave-naming runs are read with no banner posed, and it is the runs that
// appear beyond those that must be present while the banner runs and gone once it is
// out. A permanent readout is in every reading and decides nothing either way.
//
// THE POSE. An emptied, gated field on the `playing` screen. The banner is posed with
// `setWaveBanner`, which sets the timer alone, and the wave with `setWave`, which
// "spawns nothing" (`specs/instrumentation.md`); the wave loop is shut, so no banner
// the game raised of its own can be confused for the posed one and no rock arrives as
// this one ends. The wave is posed to `7`, which no other figure on the frame — a
// score of `0`, three ships — reads as.

import { afterEach, beforeEach, it } from "vitest";
import { FIELD_H, FIELD_W, WAVE_BANNER_TIME } from "../constants";
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
 * How far from the field's centre a run's box centre may sit, each way, and still
 * be the banner, in logical units.
 *
 * A quarter of the field's width and a third of its height: the middle half of the
 * field across, and its middle two thirds down. `specs/ui.md` draws the banner
 * "centred on the field" without fixing a placement to the unit and leaves the
 * layout to the build, and `specs/field.md` draws the star at the centre out to
 * `180`, so this admits a banner set across the middle and one lifted clear of the
 * halo while excluding the corners the HUD is drawn in.
 */
const REGION = { x: FIELD_W / 4, y: FIELD_H / 3 } as const;

/** The digits of a drawn run, as the number they read as; `NaN` for a run with none. */
function digitsOf(run: TextRun): number {
  return Number.parseInt(run.text.replace(/\D/g, ""), 10);
}

/** Whether a run is drawn in the middle region of the field, by its box's centre. */
function nearTheCentre(run: TextRun): boolean {
  return (
    Math.abs((run.left + run.right) / 2 - CENTRE.x) <= REGION.x &&
    Math.abs((run.top + run.bottom) / 2 - CENTRE.y) <= REGION.y
  );
}

/** A run as the same drawing across frames: its text, where its box sits. */
function identity(run: TextRun): string {
  const box = [run.left, run.top, run.right, run.bottom].map((edge) =>
    Math.round(edge),
  );
  return `${run.text}@${box.join(",")}`;
}

/** The runs drawn in the middle region of the field naming the wave. */
function wavesNamed(harness: Harness): TextRun[] {
  return textRuns(harness).filter(
    (run) => nearTheCentre(run) && digitsOf(run) === WAVE,
  );
}

/**
 * The wave-naming runs of the frame just drawn that were not among `before`: the
 * frame's own, with a readout the build keeps there in every frame set aside.
 */
function beyond(harness: Harness, before: ReadonlySet<string>): TextRun[] {
  return wavesNamed(harness).filter((run) => !before.has(identity(run)));
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

  // The region with no banner posed: whatever names the wave here is the
  // build's own readout, and is set aside from both readings below.
  clearCalls(h);
  await h.advance(1);
  const readouts = new Set(wavesNamed(h).map(identity));

  h.debug.setWaveBanner(WAVE_BANNER_TIME);
  clearCalls(h);
  await h.advance(1);
  captureStill(h, "banner");

  assertGreaterThan(
    beyond(h, readouts).length,
    0,
    `how many runs of text naming wave ${String(WAVE)} the frame drew in the middle ` +
      "region of the field while the banner was running, beyond any the build " +
      "draws there with no banner up (specs/ui.md)",
  );

  h.debug.setWaveBanner(0);
  clearCalls(h);
  await h.advance(1);

  assertEqual(
    beyond(h, readouts).length,
    0,
    `how many runs of text naming wave ${String(WAVE)} the frame drew in the middle ` +
      "region of the field once the banner had run out, beyond any the build " +
      "draws there with no banner up, where nothing of it may still be drawn " +
      "(specs/ui.md)",
  );
});
