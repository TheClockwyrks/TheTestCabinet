// modes/containment-easy — Containment at Easy opens with 350 and runs 15 waves.
//
// THE RULE. `specs/modes.md` derives the starting money and the wave count from
// the mode and the difficulty and from nothing else, and its table gives
// Containment Easy `350` and `15`. Both are reported as derived snapshot
// fields, `startMoney` and `waveCount`, so this check chooses the pair and reads
// the two figures the row fixes.
//
// WHY BOTH FIGURES AND NO OTHERS. Easy's row differs from the other two
// difficulties in exactly these two entries, so a build that ignored the
// difficulty altogether reads Medium's `250` and `20` and a build that swapped
// the ends of the table reads Hard's `200` and `26`. Every other entry of the row
// — the lives, the interest, the build zone, the hp scaling — is the same at all
// three difficulties and is `modes.difficulty-changes-nothing-else`'s business.
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

/** The two figures `specs/modes.md` gives the Containment Easy row. */
const EASY = DIFFICULTY_TABLE.easy;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("derives 350 starting money and 15 waves from Containment Easy", async () => {
  await startRun(h, "containment", "easy");
  // One frame so the canvas holds the posed run rather than whatever the loop
  // last drew. The run's own release is off and the phase releases nothing, so
  // the frame changes none of what is read below.
  await h.advance(1);
  await captureStill(h, "easy");

  const snapshot = await h.snapshot();
  assertEqual(snapshot.mode, "containment", "the mode the run was posed on");
  assertEqual(
    snapshot.difficulty,
    "easy",
    "the difficulty the run was posed on",
  );
  assertEqual(snapshot.startMoney, EASY.money, "Easy's starting money");
  assertEqual(snapshot.waveCount, EASY.waves, "Easy's wave count");
});
