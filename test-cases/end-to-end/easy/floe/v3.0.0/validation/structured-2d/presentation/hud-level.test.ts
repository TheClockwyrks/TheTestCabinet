// Floe — presentation/hud-level: the level readout names the level and the run's
// length.
//
// specs/ui.md's HUD table fixes this readout's contents exactly, and it is the
// only one of the five whose copy the specification names: "Level |
// `HUD_LEVEL_LABEL` (`LEVEL`), the current `level`, and `TOTAL_LEVELS` (`8`)".
// Three things, all three required. A build that shows `LEVEL 3` has left a
// player no idea how far through a run they are, and one that shows `3 / 8` has
// dropped the only word the specification fixed.
//
// THE READOUT IS READ INSIDE THE BAR. specs/strait.md puts the HUD at `y` in
// `[0, HUD_H]` and specs/ui.md puts all five readouts inside it, so `./hud.ts`
// takes only the runs anchored there — a build that wrote `LEVEL 1 / 8` across
// the strait has not drawn a HUD readout.
//
// THE LABEL AND THE FIGURES ARE LOOKED FOR SEPARATELY, NOT IN ONE RUN. A build is
// free to set the label and its value as two draws — a dim `LEVEL` with a bright
// `1 / 8` beside it is ordinary HUD typography — and specs/ui.md fixes the
// readout's contents, not how many `fillText` calls it takes. So the label is
// read by the shared harness's `drewText` over the bar's runs, and the figures
// against the bar's numbers.
//
// TWO LEVELS ARE POSED, AND THAT IS WHAT MAKES THE FIGURE THE CURRENT LEVEL. A
// single reading cannot tell "the current level" from a hard-coded `1`, so the
// same reading is taken at level `1` and at level `6` and each time the level's
// own figure is required. The two are chosen so that no other readout can supply
// them: `startCrossing` poses a score of `0` and `3` lives, and
// specs/progression.md gives level `1` a `30`-second timer and level `6` a
// `20`-second one, so neither `1` nor `6` is any other readout's figure at the
// level it is read on. `8` is required at BOTH, because the total is fixed and a
// build that showed the level alone shows it at neither.
//
// WHY ABSENCE IS NOT ASSERTED. It would be tighter to require that `1` has gone
// once the level is `6` — but the fifth readout is "one mark per bay", and a
// build that numbers its five marks `1`–`5` is drawing exactly what specs/ui.md
// asks for. Requiring both levels' own figures already fails a readout that does
// not follow the level, without demanding anything of the bays'.

import { afterEach, beforeEach, it } from "vitest";
import { HUD_LEVEL_LABEL, TOTAL_LEVELS } from "../constants";
import { assertContains, assertTrue } from "../assert";
import { drewText } from "../case-harness/text";
import {
  captureStill,
  createHarness,
  startCrossing,
  type DrawCall,
  type Harness,
} from "../harness";
import { renderFrame } from "./frame";
import { hudNumbers, hudRuns, hudText } from "./hud";

/** The two levels this point reads the readout at. */
const FIRST_LEVEL = 1;
const SECOND_LEVEL = 6;

/** What the HUD bar carried at one level: its runs, as text, and its figures. */
interface Readout {
  runs: string[];
  text: DrawCall[];
  numbers: number[];
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

/** A fresh crossing posed at `level`, and what the frame after it drew. */
async function readoutAt(level: number): Promise<Readout> {
  startCrossing(h, level);
  await renderFrame(h);
  return {
    runs: hudRuns(h).map((span) => span.text),
    text: hudText(h),
    numbers: hudNumbers(h),
  };
}

function assertReadout(level: number, readout: Readout): void {
  assertTrue(
    drewText(readout.text, HUD_LEVEL_LABEL),
    `the HUD bar's copy carries ${HUD_LEVEL_LABEL} at level ${level} ` +
      `(specs/ui.md) — the bar drew ${JSON.stringify(readout.runs)}`,
  );
  assertContains(
    readout.numbers,
    level,
    `the numbers the HUD bar's readouts carry at level ${level} — the level ` +
      `readout carries the current level (specs/ui.md)`,
  );
  assertContains(
    readout.numbers,
    TOTAL_LEVELS,
    `the numbers the HUD bar's readouts carry at level ${level} — the level ` +
      `readout carries the total ${TOTAL_LEVELS} (specs/ui.md)`,
  );
}

it("draws LEVEL, the current level and the total of 8 in the HUD bar", async () => {
  const first = await readoutAt(FIRST_LEVEL);
  const second = await readoutAt(SECOND_LEVEL);
  // Before the assertions, so a failing verdict still leaves the readout that
  // produced it.
  captureStill(h, "hud");

  assertReadout(FIRST_LEVEL, first);
  assertReadout(SECOND_LEVEL, second);
});
