// Meltdown — modes/containment-medium: Containment at Medium opens on 250 and
// runs 20 waves.
//
// THE RULE. `specs/modes.md`'s derived-figures table gives the row
// "Containment, Medium" a starting money of `250` and a wave count of `20`, and
// says those figures "all follow the mode and difficulty and nothing else". They
// come from `DIFFICULTY_TABLE`'s `medium` row under `MODE_TABLE`'s Containment
// row, whose own `startMoney` and `waveCount` are the difficulty's.
//
// WHY THE CAP IS `broken` HERE AND `scuffed` ON THE OTHER TWO. Containment Medium
// is the standard flow — the mode the game resets to and the difficulty a player
// meets first (`specs/instrumentation.md`: `reset` restores `mode` to
// `"containment"` and `difficulty` to `"medium"`) — so a build that gets this row
// wrong opens every ordinary run on the wrong purse and the wrong length. Easy
// and Hard are choices a player may never make.
//
// WHAT IS READ, AND WHY IT IS THE DERIVED FIELD RATHER THAN THE PURSE.
// `startMoney` and `waveCount` are snapshot fields the surface has no setter for
// — `specs/instrumentation.md` lists them among the figures that "follow" the
// mode and difficulty — so reading them back after `setMode` and `setDifficulty`
// reads exactly what this item is about. That a STARTED run opens holding
// `startMoney` is `modes.run-opens-with-its-figures`, and a build could get one
// of the two right and the other wrong.
//
// WHAT EVERY WRONG MODEL READS. The three Containment rows differ in both figures
// at once (`350`/`15`, `250`/`20`, `200`/`26`): a build that reads the Easy row
// here reads `350`/`15`, one that reads Hard's reads `200`/`26`, and one that
// takes the wave count from another mode's row reads `1` (The Hundred). There is
// no tolerance on either figure and there cannot be one — money is a whole number
// of coins and a wave count a whole number of waves — so both assertions are
// equality.

import { afterEach, beforeEach, it } from "vitest";
import { DIFFICULTY_TABLE } from "../../src/constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  startRun,
  type Harness,
} from "../harness";

/** The row this point reads, exactly as `specs/modes.md` states it. */
const MODE = "containment";
const DIFFICULTY = "medium";

/** The two figures that row fixes. */
const START_MONEY = DIFFICULTY_TABLE.medium.money;
const WAVE_COUNT = DIFFICULTY_TABLE.medium.waves;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("derives 250 starting money and 20 waves for Containment Medium", async () => {
  startRun(h, MODE, DIFFICULTY);

  await h.advance(1);
  captureStill(h, "medium");

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
    "the starting money Containment Medium derives",
  );
  assertEqual(
    figures.waveCount,
    WAVE_COUNT,
    "the wave count Containment Medium derives",
  );
});
