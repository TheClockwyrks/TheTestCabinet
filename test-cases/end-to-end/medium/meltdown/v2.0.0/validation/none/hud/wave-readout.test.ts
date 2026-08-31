// hud/wave-readout — the panel reads the current wave over the run's total, and
// follows the wave.
//
// `specs/hud.md`, The status readouts: the Wave readout is labelled
// `HUD_WAVE_LABEL` (`WAVE`) and shows "The current wave number over the run's
// total", and "Each readout follows its value as it changes."
//
// THE PAIR IS THE POINT. A panel that read the wave alone would satisfy a check
// that looked only for the wave number, so this one reads BOTH: the wave, and the
// wave count `specs/modes.md` derives from the mode and the difficulty. Only the
// wave is then moved, so the total staying put while the wave moves is what says
// the readout is a wave over a total rather than two copies of one figure.
//
// WHY CONTAINMENT ON HARD. Its wave count is `26` (`specs/modes.md`), and `26` is
// equal to no other number this panel can draw — where Medium's `20` is also the
// Forge's and the Sink's build cost and Easy's `15` is the Arc's, so on either of
// those a panel drawing no total at all would still read a `20` or a `15` from the
// shop and pass. The two waves posed, `17` and `11`, are likewise equal to nothing
// else the panel draws, and `setWave` "rebuilds nothing, releases nothing, and
// clears nothing" (`specs/instrumentation.md`).

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertTrue } from "../assert";
import { HUD_WAVE_LABEL, modeFigures } from "../constants";
import { captureStill, createHarness, startRun, type Harness } from "../harness";
import { readPanel, reads, saysWord } from "./panel";

/** The run: Containment on Hard, whose wave count is a figure nothing else equals. */
const MODE = "containment" as const;
const DIFFICULTY = "hard" as const;

/** The run's total, from `specs/modes.md`'s own table rather than from the build. */
const TOTAL = modeFigures(MODE, DIFFICULTY).waveCount;

/** The wave posed first. */
const FIRST = 17;

/** The wave posed second, which the readout must move to. */
const SECOND = 11;

/** A wave number is a whole count, so only a trailing decimal point is allowed for. */
const EXACT = 0.05;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("reads the wave over the run's total and follows setWave", async () => {
  await startRun(h, MODE, DIFFICULTY);

  await h.debug.setWave(FIRST);
  const first = await readPanel(h);
  await captureStill(h, "wave");

  await h.debug.setWave(SECOND);
  const second = await readPanel(h);

  assertEqual(TOTAL, 26, "the wave count specs/modes.md gives Containment on Hard");
  assertTrue(
    saysWord(first, HUD_WAVE_LABEL),
    `the panel to draw the ${HUD_WAVE_LABEL} label (specs/hud.md)`,
  );
  assertTrue(
    reads(first, FIRST, EXACT),
    `the panel to read wave ${FIRST} with the wave at ${FIRST}`,
  );
  assertTrue(
    reads(first, TOTAL, EXACT),
    `the panel to read the run's total of ${TOTAL} waves beside the wave`,
  );
  assertTrue(
    reads(second, SECOND, EXACT),
    `the panel to read wave ${SECOND} once the wave moved to ${SECOND}`,
  );
  assertTrue(
    !reads(second, FIRST, EXACT),
    `the panel to have stopped reading wave ${FIRST} once the wave moved to ${SECOND}`,
  );
  assertTrue(
    reads(second, TOTAL, EXACT),
    `the panel to go on reading the run's total of ${TOTAL} once the wave moved`,
  );
});
