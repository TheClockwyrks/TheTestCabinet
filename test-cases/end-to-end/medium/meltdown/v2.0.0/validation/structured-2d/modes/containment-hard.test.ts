// Meltdown — modes/containment-hard: Containment at Hard opens on 200 and runs
// 26 waves.
//
// THE RULE. `specs/modes.md`'s derived-figures table gives the row
// "Containment, Hard" a starting money of `200` and a wave count of `26`, and
// says those figures "all follow the mode and difficulty and nothing else". They
// come from `DIFFICULTY_TABLE`'s `hard` row under `MODE_TABLE`'s Containment row,
// whose own `startMoney` and `waveCount` are the difficulty's.
//
// WHAT IS READ, AND WHY IT IS THE DERIVED FIELD RATHER THAN THE PURSE.
// `startMoney` and `waveCount` are snapshot fields the surface has no setter for
// — `specs/instrumentation.md` lists them among the figures that "follow" the
// mode and difficulty — so reading them back after `setMode` and `setDifficulty`
// reads exactly what this item is about. That a STARTED run opens holding
// `startMoney` is `modes.run-opens-with-its-figures`, and a build could get one
// of the two right and the other wrong.
//
// WHY HARD IS DISTINGUISHING. It is the only row whose wave count is not a
// multiple of five and the only one below Medium's purse, so a build that ignores
// the difficulty reads `250`/`20`, one that inverted the three reads `350`/`15`,
// and one that scales the wave count off the money reads neither `26` nor
// anything near it. There is no tolerance on either figure and there cannot be
// one — money is a whole number of coins and a wave count a whole number of waves
// — so both assertions are equality.

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
const DIFFICULTY = "hard";

/** The two figures that row fixes. */
const START_MONEY = DIFFICULTY_TABLE.hard.money;
const WAVE_COUNT = DIFFICULTY_TABLE.hard.waves;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("derives 200 starting money and 26 waves for Containment Hard", async () => {
  startRun(h, MODE, DIFFICULTY);

  await h.advance(1);
  captureStill(h, "hard");

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
    "the starting money Containment Hard derives",
  );
  assertEqual(
    figures.waveCount,
    WAVE_COUNT,
    "the wave count Containment Hard derives",
  );
});
