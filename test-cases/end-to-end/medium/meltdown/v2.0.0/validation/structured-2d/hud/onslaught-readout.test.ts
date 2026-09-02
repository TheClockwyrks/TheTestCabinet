// hud/onslaught-readout — in The Hundred the wave readout reads the onslaught
// rather than a wave over a total.
//
// THE RULE. specs/hud.md, The status readouts: "In The Hundred, which runs one
// onslaught rather than a numbered progression, the wave readout reads the
// onslaught in place of a wave over a total."
//
// WHAT "IN PLACE OF" IS MEASURED AS, AND WHY NOT THE COPY. specs/hud.md fixes the
// three readout LABELS as constants and fixes no other word the panel draws, so a
// point that looked for the word `ONSLAUGHT` would be grading a build against the
// reference's vocabulary. What the specification does fix is the FORM the wave
// readout takes in a numbered run — "the current wave number over the run's
// total", one read of a pair — and that The Hundred does not take it. So the
// point is a CONTRAST across two modes on the one build:
//
//   - Containment on Medium, on Wave 17 of 20, must draw that pair: some ONE run
//     of text carrying 17 and then 20 as consecutive numbers, which is what a
//     wave-over-total read is however it is punctuated (`17/20`, `17 of 20`,
//     `WAVE 17 / 20`).
//   - The Hundred, whose wave count is `1` (specs/modes.md) on Wave 1, must draw
//     no such pair anywhere in the panel: no run reads 1 and then 1.
//
// The Containment leg is the instrument as much as it is a precondition: it is
// what says the absence in The Hundred is a mode difference rather than a panel
// that never drew a pair at all. The `WAVE` label is required in both, because it
// is the wave readout that reads the onslaught and it is still the wave readout.
//
// THE HUNDRED IS POSED IN ITS OPENING PHASE, which is the only phase it has
// between the start and the onslaught: "There is one untimed opening phase and no
// build phase between waves, because there is one wave" (specs/modes.md), and
// that phase "carries no countdown, reports a `buildTimer` of `0`"
// (specs/waves.md). So no build countdown is drawn beside the wave read on that
// leg.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertTrue } from "../assert";
import { DIFFICULTY_TABLE, HUD_WAVE_LABEL, MODE_TABLE } from "../constants";
import {
  captureStill,
  createHarness,
  startRun,
  type Harness,
} from "../harness";
import { readPanel, readsPair, saysWord } from "./panel";

/** The numbered run the contrast is drawn against. */
const NUMBERED_WAVE = 17;
const NUMBERED_TOTAL = DIFFICULTY_TABLE.medium.waves;

/** The Hundred's one wave, and its wave count. */
const ONSLAUGHT_WAVE = 1;
const ONSLAUGHT_TOTAL = MODE_TABLE.hundred.waveCount ?? 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reads no wave over a total in The Hundred, where a numbered run reads one", async () => {
  startRun(h, "containment", "medium");
  h.debug.setWave(NUMBERED_WAVE);
  const numbered = await readPanel(h);

  startRun(h, "hundred");
  h.debug.setPhase("opening");
  h.debug.setBuildTimer(0);
  h.debug.setWave(ONSLAUGHT_WAVE);
  const onslaught = await readPanel(h);
  captureStill(h, "onslaught");
  const posed = h.snapshot();

  assertEqual(
    NUMBERED_TOTAL,
    20,
    "the wave count specs/modes.md gives Containment on Medium",
  );
  assertEqual(
    ONSLAUGHT_TOTAL,
    1,
    "the wave count specs/modes.md gives The Hundred",
  );
  assertEqual(posed.mode, "hundred", "precondition: the run is The Hundred");

  assertTrue(
    readsPair(numbered, NUMBERED_WAVE, NUMBERED_TOTAL),
    `a numbered run to read wave ${NUMBERED_WAVE} over its total of ` +
      `${NUMBERED_TOTAL} in one run of text (specs/hud.md)`,
  );
  assertTrue(
    saysWord(onslaught, HUD_WAVE_LABEL),
    `The Hundred's panel to go on drawing the ${HUD_WAVE_LABEL} label`,
  );
  assertTrue(
    !readsPair(onslaught, ONSLAUGHT_WAVE, ONSLAUGHT_TOTAL),
    `The Hundred's panel to read no wave over a total, where this one reads ` +
      `${ONSLAUGHT_WAVE} over ${ONSLAUGHT_TOTAL} (specs/hud.md)`,
  );
});
