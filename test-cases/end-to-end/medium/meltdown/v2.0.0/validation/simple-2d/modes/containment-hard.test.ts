// modes/containment-hard — Containment on Hard opens with 200 and runs 26 waves.
//
// THE RULE. specs/modes.md's derived-figures table gives the row
// "Containment, Hard | 200 | 26", and states that starting money and the wave
// count "follow the mode and difficulty and nothing else". The two figures are
// read back as `startMoney` and `waveCount`, which specs/instrumentation.md lists
// among the derived fields that "follow `setMode` and `setDifficulty`" with no
// other operation.
//
// HARD IS THE DISTINGUISHING ROW, AND ITS WAVE COUNT IS THE SHARPEST FIGURE IN THE
// TABLE. `26` is the only wave count in the game that is neither `20` — which four
// of the seven rows carry — nor `15` nor `1`, and specs/waves.md derives the
// milestone Core waves from it: `round(n / 2)` is `13` in a 26-wave run where it is
// `10` in a 20-wave one. A build that ignores the difficulty reads `250` and `20`,
// one that reads Easy reads `350` and `15`, and one that scales a base figure
// rather than reading the row reads neither `200` nor `26`.
//
// WHY THE FIGURES ARE THE VALIDATOR'S OWN. `DIFFICULTY_TABLE` is
// `constants.ts`'s, this project's own transcription of the row specs/modes.md
// states. So the expected figures here are the specification's rather than the
// build's own, and the assertion is exact: they are whole numbers a
// specification fixes outright, and there is no tolerance on them.
//
// NOTHING BUT THE MODE AND THE DIFFICULTY IS POSED before the reading. The run's
// live money, lives and wave are posed afterwards, from the figures the BUILD
// derived, so the still a reviewer opens shows the build's own answer on the HUD
// (modes/run.ts) — and the reading below is taken before any of that, off the
// snapshot the two poses alone produced.

import { afterEach, beforeEach, it } from "vitest";
import { DIFFICULTY_TABLE } from "../constants";
import { assertEqual } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { drawOpening, poseMode } from "./run";

/** The pair this point reads. */
const MODE = "containment";
const DIFFICULTY = "hard";

/** The row specs/modes.md gives that pair, as the case seeded it. */
const ROW = DIFFICULTY_TABLE[DIFFICULTY];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("derives 200 starting money and 26 waves for Containment on Hard", async () => {
  poseMode(h, MODE, DIFFICULTY);
  const derived = h.snapshot();

  await drawOpening(h);
  captureStill(h, "hard");

  assertEqual(
    derived.startMoney,
    ROW.money,
    "the startMoney Containment on Hard derives (specs/modes.md, The derived figures)",
  );
  assertEqual(
    derived.waveCount,
    ROW.waves,
    "the waveCount Containment on Hard derives (specs/modes.md, The derived figures)",
  );
});
