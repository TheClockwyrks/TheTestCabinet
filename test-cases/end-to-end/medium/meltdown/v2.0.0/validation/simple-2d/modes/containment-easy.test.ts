// modes/containment-easy — Containment on Easy opens with 350 and runs 15 waves.
//
// THE RULE. specs/modes.md's derived-figures table gives the row
// "Containment, Easy | 350 | 15", and states that "Starting money, the wave count,
// the starting lives, whether interest is paid, whether there are build phases
// between waves, and the build zone all follow the mode and difficulty and nothing
// else". The two figures are read back as `startMoney` and `waveCount`, which
// specs/instrumentation.md lists among the derived fields that "follow `setMode`
// and `setDifficulty`" with no other operation.
//
// WHY THE FIGURES ARE READ FROM THE CASE'S OWN TABLE. `DIFFICULTY_TABLE` is in
// `src/constants.ts`, the module the case SEEDS and the build is told not to edit,
// and specs/modes.md names it as where the row lives. So the expected figures here
// are the ones the build was handed, and the assertion is exact: they are whole
// numbers a specification fixes outright, and there is no tolerance on them.
//
// EASY IS THE DISTINGUISHING ROW. `350` and `15` are shared with no other row of
// the table: a build that ignores the difficulty altogether reads Medium's `250`
// and `20`, one that reads Hard reads `200` and `26`, and one that reads the
// difficulty against the wrong end of the table reads Hard's figures for Easy. Each
// is a different pair from this one, so a failure names which wrong model the build
// implemented.
//
// NOTHING BUT THE MODE AND THE DIFFICULTY IS POSED before the reading. The run's
// live money, lives and wave are posed afterwards, from the figures the BUILD
// derived, so the still a reviewer opens shows the build's own answer on the HUD
// (modes/run.ts) — and the reading below is taken before any of that, off the
// snapshot the two poses alone produced.
//
// WHAT THIS POINT DOES NOT DECIDE. That a started run actually opens holding that
// money is `modes.run-opens-with-its-figures`; that Easy leaves the lives, the
// interest, the build zone and the hp scaling alone is
// `modes.difficulty-changes-nothing-else`.

import { afterEach, beforeEach, it } from "vitest";
import { DIFFICULTY_TABLE } from "../../src/constants";
import { assertEqual } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { drawOpening, poseMode } from "./run";

/** The pair this point reads. */
const MODE = "containment";
const DIFFICULTY = "easy";

/** The row specs/modes.md gives that pair, as the case seeded it. */
const ROW = DIFFICULTY_TABLE[DIFFICULTY];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("derives 350 starting money and 15 waves for Containment on Easy", async () => {
  poseMode(h, MODE, DIFFICULTY);
  const derived = h.snapshot();

  await drawOpening(h);
  captureStill(h, "easy");

  assertEqual(
    derived.startMoney,
    ROW.money,
    "the startMoney Containment on Easy derives (specs/modes.md, The derived figures)",
  );
  assertEqual(
    derived.waveCount,
    ROW.waves,
    "the waveCount Containment on Easy derives (specs/modes.md, The derived figures)",
  );
});
