// modes/containment-medium — Containment at Medium opens with 250 and runs 20
// waves.
//
// THE RULE. `specs/modes.md` derives the starting money and the wave count from
// the mode and the difficulty and from nothing else, and its table gives
// Containment Medium `250` and `20`. Both are reported as derived snapshot
// fields, `startMoney` and `waveCount`, so this check chooses the pair and reads
// the two figures the row fixes.
//
// WHY THIS ONE IS THE STANDARD FLOW. Medium is the difficulty `reset` leaves the
// game on and the one the standard run is played at, which is why its cap is the
// hardest of the three: a build that has these two figures wrong has the ordinary
// game wrong. The distinguishing values are the other two rows — a build that
// leaned Easy reads `350` and `15`, one that leaned Hard reads `200` and `26`.
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

/** The two figures `specs/modes.md` gives the Containment Medium row. */
const MEDIUM = DIFFICULTY_TABLE.medium;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("derives 250 starting money and 20 waves from Containment Medium", async () => {
  await startRun(h, "containment", "medium");
  // One frame so the canvas holds the posed run rather than whatever the loop
  // last drew. The run's own release is off and the phase releases nothing, so
  // the frame changes none of what is read below.
  await h.advance(1);
  await captureStill(h, "medium");

  const snapshot = await h.snapshot();
  assertEqual(snapshot.mode, "containment", "the mode the run was posed on");
  assertEqual(
    snapshot.difficulty,
    "medium",
    "the difficulty the run was posed on",
  );
  assertEqual(snapshot.startMoney, MEDIUM.money, "Medium's starting money");
  assertEqual(snapshot.waveCount, MEDIUM.waves, "Medium's wave count");
});
