// hud/onslaught-readout — in The Hundred the wave readout reads the onslaught
// rather than a wave over a total.
//
// THE RULE. specs/hud.md, The status readouts: "In The Hundred, which runs one
// onslaught rather than a numbered progression, the wave readout reads the
// onslaught in place of a wave over a total." specs/modes.md gives The Hundred a
// `waveCount` of `1`, so the numbered form it must NOT fall back on is `1` over
// `1`.
//
// THE CHECK IS THE ABSENCE OF THE NUMBERED FORM, BECAUSE THE WORDS ARE THE
// BUILD'S. specs/hud.md fixes the label `HUD_WAVE_LABEL` and no other copy: a
// build may read the onslaught as "ONSLAUGHT", "THE HUNDRED", "100 INCOMING" or
// anything else that is not a wave over a total, and every one of those is
// conformant. What the specification does fix is what the readout is IN PLACE OF,
// so that is what is read: a run of text carrying the wave and then the total as
// two figures, which is the numbered progression's form and the one thing this
// mode may not show.
//
// THE CONTROL LEG IS WHAT KEEPS THE VERDICT FROM BEING VACUOUS. A build that
// draws no wave readout at all also draws no wave over a total, and would clear
// the negative above without having met anything. So the same panel is read first
// on Containment, where specs/hud.md DOES ask for a wave over a total, and both
// figures must be there. The pair is the same shape as the running leg of a pause
// check: one leg proves the build has the thing, the other that this mode does
// not show it.
//
// CONTAINMENT ON HARD FOR THE CONTROL LEG, because specs/modes.md gives that pair
// 26 waves against the 20 lives every mode but Sudden Death opens on, so the
// total is a figure nothing else on the panel carries. The wave posed, `5`, is
// neither a shop cost nor a life count.
//
// THE PHASE IS `wave` ON BOTH LEGS, the quietest panel this case has: specs/hud.md
// draws the build countdown only in a build phase and the next-wave preview only
// in a build or opening phase, and The Hundred's preview would otherwise put its
// own count of `100` into the strip.
//
// WHAT IT DOES NOT DECIDE. That the numbered readout is drawn correctly is
// `hud.wave-readout`; what The Hundred fields is `modes.the-hundred-*`.

import { afterEach, beforeEach, it } from "vitest";
import { assertTrue } from "../assert";
import {
  captureStill,
  createHarness,
  startRun,
  waveCountOf,
  type Harness,
  type TextSpan,
} from "../harness";
import { readPanel, readsNumber, textsOf } from "./read";

/** The mode whose readout must NOT read a wave over a total. */
const ONSLAUGHT_MODE = "hundred";

/** The pair whose readout must, so the negative above means something. */
const NUMBERED_MODE = "containment";
const NUMBERED_DIFFICULTY = "hard";

/** The wave posed on the control leg, and that pair's total: 26. */
const NUMBERED_WAVE = 5;
const NUMBERED_TOTAL = waveCountOf(NUMBERED_MODE, NUMBERED_DIFFICULTY);

/** The money and the lives posed on the control leg, carrying neither figure. */
const MONEY = 9999;
const LIVES = 17;

/**
 * Whether some run of text reads `wave` and then `total` as two figures with
 * nothing but a separator between them.
 *
 * The numbered progression's form, however a build spells it: `"5/26"`,
 * `"5 / 26"` and `"WAVE 5 OF 26"` all match, and two figures four or more
 * characters apart do not, because that is no longer one reading of a wave over a
 * total. It is deliberately narrow — a build whose Hundred readout carries the
 * two figures in two separate runs is not caught — because the cost of being wide
 * here is failing a build that drew a perfectly good onslaught readout.
 */
function readsWaveOverTotal(
  spans: readonly TextSpan[],
  wave: number,
  total: number,
): boolean {
  const pattern = /(?<!\d)(\d+)(?:\.\d+)?\D{1,4}(\d+)(?:\.\d+)?(?!\d)/g;
  return spans.some((span) => {
    const text = span.text.replace(/,/g, "");
    pattern.lastIndex = 0;
    for (
      let match = pattern.exec(text);
      match !== null;
      match = pattern.exec(text)
    ) {
      if (Number(match[1]) === wave && Number(match[2]) === total) return true;
    }
    return false;
  });
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reads the onslaught rather than a wave over a total in The Hundred", async () => {
  startRun(h, NUMBERED_MODE, NUMBERED_DIFFICULTY);
  h.debug.setPhase("wave");
  h.debug.setMoney(MONEY);
  h.debug.setLives(LIVES);
  h.debug.setWave(NUMBERED_WAVE);
  const numbered = (await readPanel(h)).info;

  assertTrue(
    readsNumber(numbered, NUMBERED_WAVE) &&
      readsNumber(numbered, NUMBERED_TOTAL),
    `wave ${NUMBERED_WAVE} and the total of ${NUMBERED_TOTAL} both drawn in ` +
      `the panel on ${NUMBERED_MODE}/${NUMBERED_DIFFICULTY}, which is the ` +
      `numbered progression The Hundred replaces (specs/hud.md, The status ` +
      `readouts); the panel drew ${JSON.stringify(textsOf(numbered))}`,
  );

  startRun(h, ONSLAUGHT_MODE);
  h.debug.setPhase("wave");
  const onslaught = (await readPanel(h)).info;
  captureStill(h, "onslaught");
  const total = h.snapshot().waveCount;
  const wave = h.snapshot().wave;

  assertTrue(
    !readsWaveOverTotal(onslaught, wave, total),
    `no wave over a total in The Hundred's panel, which runs one onslaught ` +
      `rather than a numbered progression and reads the onslaught in its ` +
      `place (specs/hud.md, The status readouts); the panel drew ` +
      `${JSON.stringify(textsOf(onslaught))}, reading wave ${wave} over ` +
      `${total}`,
  );
});
