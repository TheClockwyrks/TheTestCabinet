// modes/sudden-death-one-life — Sudden Death opens on a single life.
//
// THE RULE. specs/modes.md's derived-figures table gives the Sudden Death row a
// Lives figure of `1`, and names the constant underneath it: "The starting lives are
// `START_LIVES` (`20`) on every mode but Sudden Death, whose `SUDDEN_DEATH_LIVES` is
// `1`." Its own section says the same: "Sudden Death opens on `1` life". The figure
// is read back as `startLives`, which specs/instrumentation.md lists among the
// derived fields that follow `setMode` with no other operation.
//
// ONE LIFE IS THE MODE. Every other row of the table reads `20`, so this is the one
// figure that makes Sudden Death what it is, and it is the sharpest reading in the
// group: a build that fell through to `START_LIVES` reads `20`, twenty times the
// figure, and a build that treated "sudden death" as a rule applied at the leak
// rather than as a starting figure reads `20` as well. There is no near miss.
//
// WHY THE FIGURE IS THE VALIDATOR'S OWN. `MODE_TABLE` and `SUDDEN_DEATH_LIVES`
// are `constants.ts`'s, this project's own transcription of the row
// specs/modes.md states. So the expected figure is the specification's rather
// than the build's own, and the assertion is exact: a whole number a
// specification fixes outright, with no tolerance on it.
//
// NOTHING BUT THE MODE IS POSED before the reading. The run's live money, lives and
// wave are posed afterwards, from the figures the BUILD derived, so the still a
// reviewer opens shows the build's own answer on the HUD (modes/run.ts).
//
// WHAT THIS POINT DOES NOT DECIDE. That a single leak then ends the run is
// `modes.sudden-death-ends-on-one-leak`, and that a started run is handed the figure
// at all is `modes.run-opens-with-its-figures`.

import { afterEach, beforeEach, it } from "vitest";
import { SUDDEN_DEATH_LIVES } from "../constants";
import { assertEqual } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { drawOpening, poseMode } from "./run";

/** The mode this point reads. */
const MODE = "suddendeath";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("derives a single starting life for Sudden Death", async () => {
  poseMode(h, MODE);
  const derived = h.snapshot();

  await drawOpening(h);
  captureStill(h, "life");

  assertEqual(
    derived.startLives,
    SUDDEN_DEATH_LIVES,
    "the startLives Sudden Death derives (specs/modes.md, The derived figures)",
  );
});
