// presentation/hud-score — the HUD shows the running score.
//
// specs/ui.md's HUD table: the score readout shows "The running score, as digits.
// It is the most prominent of the three." specs/board.md puts it on the bar, at
// `y` in `[0, HUD_H]` (`[0, 80]`), and says the readouts are drawn inside it. The
// score is what every scoring rule in specs/scoring.md pays into, so a bar that
// does not carry it leaves a player with no reading of the run at all.
//
// THE FIGURE IS POSED AND THE BAR IS READ. `setScore` is a precondition and
// nothing else — specs/instrumentation.md: "It grants no bonus life: the award
// belongs to the scoring path" — so the board this runs on is the empty, quiet
// one `startPlaying` opens, with a score written onto it and nothing else
// touched.
//
// `12345` IS CHOSEN SO IT CANNOT BE ANYTHING ELSE ON THE BAR. Five digits, none
// repeated, and no other readout at these settings spells it: the level is `1`,
// the total is `TOTAL_LEVELS` (`12`), and the lives are `START_LIVES` (`3`). So a
// run of digits reading `12345` is the score and can be nothing but the score.
//
// HOW THE FIGURE IS COMPOSED IS THE BUILD'S. specs/ui.md fixes the figure and not
// its presentation, so a label around it (`SCORE 12,345`), a thousands separator,
// and zero padding (`012345`) all read as the same figure — and a bar that drew
// its digits one glyph at a time is read across the whole bar, left to right, so
// a build that spells the score out in single characters is not failed for the
// way it draws them.

import { afterEach, beforeEach, it } from "vitest";
import { assertTrue } from "../assert";
import {
  captureStill,
  createHarness,
  startPlaying,
  type Harness,
} from "../harness";
import {
  barText,
  digitsAcross,
  figuresIn,
  hudSpanForms,
  hudSpans,
} from "./hud";

/**
 * The score this point poses.
 *
 * The review item's own figure. It is five digits with none repeated, so it
 * cannot be confused with the level, the total or the lives that share the bar,
 * and it is large enough that a build padding it to a fixed width still spells
 * it out.
 */
const SCORE = 12345;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws the posed score on the HUD bar", async () => {
  startPlaying(h);
  h.debug.setScore(SCORE);
  h.calls.length = 0;
  await h.advance(1);
  captureStill(h, "hud");

  // As one run: a call, or the run a glyph-per-call score coalesces into.
  const forms = hudSpanForms(h);
  const asOneRun = forms.some((span) => figuresIn(span).includes(SCORE));
  // Across the bar: the calls alone, left to right, so a run is not read twice.
  const acrossTheBar = digitsAcross(hudSpans(h)).includes(String(SCORE));

  assertTrue(
    asOneRun || acrossTheBar,
    `the score ${SCORE} drawn on the HUD bar, y in [0, 80] (specs/ui.md: the ` +
      "running score, as digits; specs/board.md: the readouts are drawn " +
      `inside the HUD bar) — the bar drew ${barText(forms)}`,
  );
});
