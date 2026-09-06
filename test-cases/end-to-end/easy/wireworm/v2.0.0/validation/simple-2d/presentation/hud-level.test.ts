// presentation/hud-level — the HUD shows the level and the total.
//
// specs/ui.md's HUD table gives the level readout three parts: "`HUD_LEVEL_LABEL`
// (`LEVEL`), the current level's digits beside it, and `TOTAL_LEVELS` (`12`) on
// the bar as well", and then says in as many words that "How the level readout is
// composed around those three parts is yours." So the three parts are what is
// asserted, and the composition — a slash, the word `OF`, the label stacked above
// the digits — is not: a build is free to write `LEVEL 7 / 12`, `LEVEL 7 OF 12`,
// or the label over the pair.
//
// THE LEVEL DIGITS ARE REQUIRED TO BE BESIDE THE LABEL, because "beside it" is
// the half of the sentence that separates a readout from a `7` that happens to be
// somewhere on the bar. Adjacency is measured as the gap between the two runs of
// text — zero where the digits are inside the label's own run, and the distance
// between the runs otherwise — so a build that stacks the label above the digits
// is read the same as one that writes them on a line.
//
// THE TOTAL IS REQUIRED ONLY TO BE ON THE BAR, which is exactly what specs/ui.md
// asks of it: "`TOTAL_LEVELS` (`12`) on the bar as well".
//
// LEVEL `7` IS CHOSEN SO IT CANNOT BE ANYTHING ELSE ON THE BAR. At these settings
// the score is `0`, the lives are `START_LIVES` (`3`), and the total is `12`, so a
// run of digits reading `7` is the level and can be nothing but the level.
// `setLevel` is a precondition and nothing else — specs/instrumentation.md: "It
// spawns nothing and clears nothing" — so the board this runs on is the empty,
// quiet one `startPlaying` opens with a level written onto it.

import { afterEach, beforeEach, it } from "vitest";
import { HUD_LEVEL_LABEL, TOTAL_LEVELS } from "../constants";
import { assertTrue } from "../assert";
import {
  captureStill,
  createHarness,
  startPlaying,
  type Harness,
} from "../harness";
import { barText, figuresIn, gapBetween, hudSpanForms } from "./hud";

/**
 * The level this point poses.
 *
 * The review item's own figure. It is a single digit that no other readout on the
 * bar carries at these settings — the score is `0`, the lives are `3`, and the
 * total is `12` — so the digit beside the label is unambiguously the level.
 */
const LEVEL = 7;

/**
 * How far the level's digits may sit from the `LEVEL` label and still be read as
 * beside it, in logical units.
 *
 * specs/ui.md asks for the digits "beside it" and fixes no distance, because the
 * composition is the build's: the label may sit to the left of the digits, or
 * above them. `160` units is five tiles — comfortably more than a label and its
 * digits at any size that fits an `80`-unit bar, and a small fraction of the
 * `1280`-unit bar the three readouts are spread across, so a `7` belonging to
 * some other readout could not be mistaken for this one at that distance. The
 * `none` and `structured-2d` suites take the same measure against the same
 * figure.
 */
const ADJACENT_MAX = 160;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws the LEVEL label with the level beside it, and the total on the bar", async () => {
  startPlaying(h);
  h.debug.setLevel(LEVEL);
  h.calls.length = 0;
  await h.advance(1);
  captureStill(h, "hud");

  // The bar's calls and the runs they spell, so a label or a figure the build
  // letter-spaced a glyph per call is found in the run it spells.
  const spans = hudSpanForms(h);
  const labels = spans.filter((span) =>
    span.text.toLowerCase().includes(HUD_LEVEL_LABEL.toLowerCase()),
  );
  assertTrue(
    labels.length > 0,
    `the label ${HUD_LEVEL_LABEL} drawn on the HUD bar, y in [0, 80] ` +
      "(specs/ui.md) — the bar drew " +
      barText(spans),
  );

  assertTrue(
    labels.some((label) =>
      spans.some(
        (span) =>
          figuresIn(span).includes(LEVEL) &&
          gapBetween(label, span) <= ADJACENT_MAX,
      ),
    ),
    `the current level's digits (${LEVEL}) drawn within ${ADJACENT_MAX} units ` +
      `of the ${HUD_LEVEL_LABEL} label (specs/ui.md: the current level's ` +
      `digits beside it) — the bar drew ${barText(spans)}`,
  );

  assertTrue(
    spans.some((span) => figuresIn(span).includes(TOTAL_LEVELS)),
    `TOTAL_LEVELS (${TOTAL_LEVELS}) drawn somewhere on the HUD bar ` +
      "(specs/ui.md: TOTAL_LEVELS on the bar as well) — the bar drew " +
      barText(spans),
  );
});
