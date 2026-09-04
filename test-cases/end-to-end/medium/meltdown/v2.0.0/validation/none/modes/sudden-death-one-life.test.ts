// modes/sudden-death-one-life — Sudden Death starts on one life.
//
// THE RULE. `specs/modes.md`'s table gives Sudden Death `1` under Lives, its own
// section repeats it — "Sudden Death opens on `1` life" — and the figure carries a
// name of its own, `SUDDEN_DEATH_LIVES`, set apart from the `START_LIVES` (`20`)
// every other row uses. The snapshot reports it as the derived field `startLives`.
//
// WHY THE DERIVED FIGURE AND NOT THE LIVE ONE. `lives` is the run's own live
// counter and a scenario poses it, so reading it back would grade this project's
// arithmetic rather than the build's. `startLives` follows the mode and the
// difficulty and nothing else (`specs/instrumentation.md`), so it is the build's
// own answer to what this mode starts on.
//
// WHAT A WRONG MODEL READS. A build that forgot the mode's one departure from the
// table reads `20`, the figure every other row carries. There is no third
// plausible number, which is why one reading decides this item and the
// consequence of that one life — a single leak ending the run — is
// `modes.sudden-death-ends-on-one-leak`'s.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { SUDDEN_DEATH_LIVES } from "../constants";
import {
  captureStill,
  createHarness,
  startRun,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("derives one starting life from Sudden Death", async () => {
  await startRun(h, "suddendeath");
  // One frame so the canvas holds the posed run rather than whatever the loop
  // last drew. The run's own release is off, so the frame changes nothing read
  // below.
  await h.advance(1);
  await captureStill(h, "life");

  const snapshot = await h.snapshot();
  assertEqual(snapshot.mode, "suddendeath", "the mode the run was posed on");
  assertEqual(
    snapshot.startLives,
    SUDDEN_DEATH_LIVES,
    "Sudden Death's starting lives",
  );
});
