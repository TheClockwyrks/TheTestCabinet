// modes/containment-medium — Containment on Medium opens with 250 and runs 20
// waves.
//
// THE RULE. specs/modes.md's derived-figures table gives the row
// "Containment, Medium | 250 | 20", and states that starting money and the wave
// count "follow the mode and difficulty and nothing else". The two figures are
// read back as `startMoney` and `waveCount`, which specs/instrumentation.md lists
// among the derived fields that "follow `setMode` and `setDifficulty`" with no
// other operation.
//
// WHY THIS ONE IS CAPPED `broken` WHERE ITS TWO SIBLINGS ARE CAPPED `scuffed`.
// Containment on Medium is the standard flow — the pair a player reaches by taking
// the first row of every menu — so a build that opens it on the wrong purse or
// fights the wrong number of waves has the ordinary run wrong, not an optional
// path. Easy and Hard are the optional paths.
//
// MEDIUM IS THE DISTINGUISHING ROW. `250` and `20` are shared with no other row of
// the table: a build reading Easy reads `350` and `15`, one reading Hard reads
// `200` and `26`, one that ignores the difficulty and hardcodes a single purse
// reads whichever it hardcoded. Each is a different pair from this one, so a
// failure names which wrong model the build implemented.
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
import { assertEqual } from "../assert";
import { DIFFICULTY_TABLE } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { drawOpening, poseMode } from "./run";

/** The pair this point reads. */
const MODE = "containment";
const DIFFICULTY = "medium";

/** The row specs/modes.md gives that pair, as the case seeded it. */
const ROW = DIFFICULTY_TABLE[DIFFICULTY];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("derives 250 starting money and 20 waves for Containment on Medium", async () => {
  poseMode(h, MODE, DIFFICULTY);
  const derived = h.snapshot();

  await drawOpening(h);
  captureStill(h, "medium");

  assertEqual(
    derived.startMoney,
    ROW.money,
    "the startMoney Containment on Medium derives (specs/modes.md, The derived figures)",
  );
  assertEqual(
    derived.waveCount,
    ROW.waves,
    "the waveCount Containment on Medium derives (specs/modes.md, The derived figures)",
  );
});
