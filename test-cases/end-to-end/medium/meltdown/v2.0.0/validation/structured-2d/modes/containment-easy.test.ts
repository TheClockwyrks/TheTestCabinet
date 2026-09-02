// Meltdown — modes/containment-easy: Containment at Easy opens on 350 and runs
// 15 waves.
//
// THE RULE. `specs/modes.md`'s derived-figures table gives the row
// "Containment, Easy" a starting money of `350` and a wave count of `15`, and
// says those figures "all follow the mode and difficulty and nothing else". The
// same file names the table they come from: `DIFFICULTY_TABLE`'s `easy` row,
// under `MODE_TABLE`'s Containment row, whose own `startMoney` and `waveCount`
// are the difficulty's.
//
// WHAT IS READ, AND WHY IT IS THE DERIVED FIELD RATHER THAN THE PURSE.
// `startMoney` and `waveCount` are snapshot fields the surface has no setter for
// — `specs/instrumentation.md` lists them among the figures that "follow" the
// mode and difficulty — so reading them back after `setMode` and `setDifficulty`
// reads exactly what this item is about. The live `money` is a different
// question: `modes.run-opens-with-its-figures` is what decides that a started run
// opens holding `startMoney`, and a build could get one of the two right and the
// other wrong.
//
// WHY EASY IS DISTINGUISHING. The three Containment rows differ in both figures
// at once (`350`/`15`, `250`/`20`, `200`/`26`), so every wrong model reads a
// different pair: a build that ignores the difficulty entirely reads Medium's
// `250`/`20`, one that inverted the three reads Hard's `200`/`26`, and one that
// derives the wave count from the money or the money from the wave count reads
// neither. There is no tolerance on either figure and there cannot be one — money
// is a whole number of coins and a wave count a whole number of waves, and
// `specs/modes.md` fixes both exactly — so both assertions are equality.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { DIFFICULTY_TABLE } from "../constants";
import {
  captureStill,
  createHarness,
  startRun,
  type Harness,
} from "../harness";

/** The row this point reads, exactly as `specs/modes.md` states it. */
const MODE = "containment";
const DIFFICULTY = "easy";

/** The two figures that row fixes. */
const START_MONEY = DIFFICULTY_TABLE.easy.money;
const WAVE_COUNT = DIFFICULTY_TABLE.easy.waves;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("derives 350 starting money and 15 waves for Containment Easy", async () => {
  startRun(h, MODE, DIFFICULTY);

  await h.advance(1);
  captureStill(h, "easy");

  const figures = h.snapshot();
  assertEqual(figures.mode, MODE, "precondition: the mode the run is posed on");
  assertEqual(
    figures.difficulty,
    DIFFICULTY,
    "precondition: the difficulty the run is posed on",
  );
  assertEqual(
    figures.startMoney,
    START_MONEY,
    "the starting money Containment Easy derives",
  );
  assertEqual(
    figures.waveCount,
    WAVE_COUNT,
    "the wave count Containment Easy derives",
  );
});
