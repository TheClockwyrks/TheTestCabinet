// modes/containment-hard — Containment at Hard opens with 200 and runs 26 waves.
//
// THE RULE. `specs/modes.md` derives the starting money and the wave count from
// the mode and the difficulty and from nothing else, and its table gives
// Containment Hard `200` and `26`. Both are reported as derived snapshot fields,
// `startMoney` and `waveCount`, so this check chooses the pair and reads the two
// figures the row fixes.
//
// WHY HARD IS WORTH ITS OWN CHECK. It is the only row whose wave count is not
// one of the two round numbers the rest of the table uses, and the count decides
// where the two Core milestones fall — `round(26 / 2)` is 13 — so a build that
// clamped the count to twenty plays a different run entirely. A build that
// ignored the difficulty reads Medium's `250` and `20`; one that read the table
// backwards reads Easy's `350` and `15`.
//
// The run is posed live rather than left on the title screen so the picture kept
// as evidence is the one a player sees: the panel's WAVE readout draws the
// current wave over the run's total (`specs/hud.md`), which is where the wave
// count shows.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { DIFFICULTY_TABLE } from "../constants";
import {
  captureStill,
  createHarness,
  startRun,
  type Harness,
} from "../harness";

/** The two figures `specs/modes.md` gives the Containment Hard row. */
const HARD = DIFFICULTY_TABLE.hard;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("derives 200 starting money and 26 waves from Containment Hard", async () => {
  await startRun(h, "containment", "hard");
  // One frame so the canvas holds the posed run rather than whatever the loop
  // last drew. The run's own release is off and the phase releases nothing, so
  // the frame changes none of what is read below.
  await h.advance(1);
  await captureStill(h, "hard");

  const snapshot = await h.snapshot();
  assertEqual(snapshot.mode, "containment", "the mode the run was posed on");
  assertEqual(
    snapshot.difficulty,
    "hard",
    "the difficulty the run was posed on",
  );
  assertEqual(snapshot.startMoney, HARD.money, "Hard's starting money");
  assertEqual(snapshot.waveCount, HARD.waves, "Hard's wave count");
});
