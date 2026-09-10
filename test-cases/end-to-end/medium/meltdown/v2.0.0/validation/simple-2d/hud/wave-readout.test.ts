// hud/wave-readout — the panel draws the current wave over the run's total, and
// the wave figure follows the wave.
//
// THE RULE. specs/hud.md, The status readouts: the Wave readout shows "the
// current wave number over the run's total", and "each readout follows its value
// as it changes". The total is the `waveCount` specs/modes.md derives from the
// mode and the difficulty.
//
// BOTH FIGURES, BECAUSE THE READOUT IS A PAIR. A build that draws the wave and
// not the total has drawn half the readout, and one that draws the total and not
// the wave has drawn the other half, so both are read. The two are read as
// FIGURES rather than as a format: specs/hud.md says the readout shows one over
// the other and never fixes a spelling, so `"7/26"`, `"WAVE 7 OF 26"` and a wave
// beside a total in two runs all read the same here.
//
// TWO MOMENTS, BECAUSE THE WAVE FOLLOWS. The wave is posed, read, posed again and
// read again, and the first wave number has to be gone by the second reading —
// which is what separates a readout from a panel that letters a number once. The
// total does not move between the two readings, because a run's total is fixed by
// its mode and difficulty and `setWave` "rebuilds, releases and clears nothing"
// (specs/instrumentation.md).
//
// CONTAINMENT ON HARD, BECAUSE ITS TOTAL IS THE ONE FIGURE NOTHING ELSE CARRIES.
// specs/modes.md gives that pair 26 waves, against the 20 lives every mode but
// Sudden Death opens on; on Medium the two would both read `20` and a build that
// drew the lives twice would pass. The two waves posed, `7` and `13`, are neither
// a shop cost, a life count, the total, nor within a rounding of one.
//
// THE PHASE IS `wave`, the quietest panel this case has: specs/hud.md draws the
// build countdown only in a build phase and the next-wave preview only in a build
// or opening phase, so no other figure enters the strip under the reading.
//
// WHAT IT DOES NOT DECIDE. How many waves a mode fights is `modes.*`, what a wave
// releases is `waves.*`, and what The Hundred's readout reads instead is
// `hud.onslaught-readout`.

import { afterEach, beforeEach, it } from "vitest";
import { assertTrue } from "../assert";
import {
  captureStill,
  createHarness,
  startRun,
  waveCountOf,
  type Harness,
} from "../harness";
import { readPanel, readsNumber, readsPair, textsOf } from "./read";

/** The pair whose wave total is carried by nothing else on the panel. */
const MODE = "containment";
const DIFFICULTY = "hard";

/** The run's total, as specs/modes.md derives it for that pair: 26. */
const TOTAL = waveCountOf(MODE, DIFFICULTY);

/** The two waves posed, neither a cost, a life count nor the total. */
const FIRST = 7;
const SECOND = 13;

/** The money and the lives posed under the reading, carrying neither wave. */
const MONEY = 9999;
const LIVES = 17;

// THE NEGATIVE IS READ AS A PAIR, NOT AS A BARE FIGURE. specs/hud.md gives the
// wave readout "the current wave number over the run's total", and fixes three
// readouts and a build timer and nothing else about the strip — so the panel is
// free to carry figures of its own, and asking whether the OLD wave number is
// ANYWHERE on the panel reads those too: a build lettering its panel
// `REACTOR CONTROL / 07` carries a 7 on every wave and would fail an assertion
// that no 7 is left once the wave moved on. What the readout IS is the wave
// beside the total, so that is what the check that it stopped reading the old
// wave looks for. The positive readings stay bare figures: they are satisfied by
// the readout wherever the build laid it out.

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws the current wave over the run's total, and follows the wave", async () => {
  startRun(h, MODE, DIFFICULTY);
  h.debug.setPhase("wave");
  h.debug.setMoney(MONEY);
  h.debug.setLives(LIVES);

  h.debug.setWave(FIRST);
  const first = (await readPanel(h)).info;
  captureStill(h, "wave");

  assertTrue(
    readsNumber(first, FIRST),
    `the current wave ${FIRST} drawn in the build panel (specs/hud.md, The ` +
      `status readouts); the panel drew ${JSON.stringify(textsOf(first))}`,
  );
  assertTrue(
    readsNumber(first, TOTAL),
    `the run's total of ${TOTAL} waves drawn in the build panel beside the ` +
      `current wave, which ${MODE} on ${DIFFICULTY} fights (specs/hud.md, ` +
      `specs/modes.md); the panel drew ${JSON.stringify(textsOf(first))}`,
  );

  h.debug.setWave(SECOND);
  const second = (await readPanel(h)).info;

  assertTrue(
    readsNumber(second, SECOND),
    `the current wave ${SECOND} drawn in the build panel once the wave ` +
      `changed — "each readout follows its value as it changes" ` +
      `(specs/hud.md); the panel drew ${JSON.stringify(textsOf(second))}`,
  );
  assertTrue(
    !readsPair(second, FIRST, TOTAL),
    `no reading of ${FIRST} over ${TOTAL} left in the build panel on wave ` +
      `${SECOND}: the readout shows the CURRENT wave (specs/hud.md, The ` +
      `status readouts); the panel drew ${JSON.stringify(textsOf(second))}`,
  );
  assertTrue(
    readsNumber(second, TOTAL),
    `the run's total of ${TOTAL} waves still drawn on wave ${SECOND}: the ` +
      `total is fixed by the mode and the difficulty and a wave does not move ` +
      `it (specs/hud.md, specs/modes.md); the panel drew ` +
      `${JSON.stringify(textsOf(second))}`,
  );
});
