// runs/play-resumes-a-paused-run — one press of `play` on a paused run takes it back
// to `running`, and the clock starts moving again.
//
// THE RULE. "While the status is `running` or `paused`, `play` toggles between the
// two" (`specs/editor.md`, Running the machine); `specs/controls.md` binds it to
// `Space` and gives "`editor`, `running` or `paused`" the row that reads it. What
// `running` means for the clock is `specs/simulation.md`: "The fraction advances only
// while the status is `running`, so pausing holds it where it is."
//
// THE CONFIGURATION. A live run on a posed challenge with an EMPTY machine and an
// EMPTY field, opened PAUSED through `setPaused(true)` — the gate
// `specs/instrumentation.md` names for the run's clock, which "Moves `sim.status`
// between `running` and `paused`, exactly as the `play` toggle moves it". Nothing can
// fault and nothing can be delivered, so the only thing the frames this check drives
// can move is the clock.
//
// THE PAUSE IS READ AS A REAL ONE FIRST. Three cycles' worth of game time is handed
// to the paused run and the fraction does not move, so the fraction that moves after
// the press is a clock that was genuinely held and then released, rather than one
// that had been running all along.
//
// THE VERDICT. `sim.status` is `running` after one press, and half a cycle of game
// time driven after it raises `sim.fraction` by exactly `0.5` from where the press
// left it, with no boundary crossed. The fraction is read through `assertNear` at
// `FRACTION_TOLERANCE`, since `specs/instrumentation.md` carries it as a running sum
// of the frames' own delta times, which "agree to within the rounding of that sum
// rather than bit for bit".

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear, assertNotNull } from "../assert";
import { FRACTION_TOLERANCE } from "../constants";
import { BARE } from "../fixtures";
import {
  advanceCycles,
  advanceFraction,
  captureReplay,
  createHarness,
  openBareRun,
  playAction,
  type Harness,
} from "../harness";

/** How much game time the paused run is handed before the press. */
const HELD_CYCLES = 3;

/** How much of a cycle is driven after the press, to read the clock moving. */
const RESUMED = 0.5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("sets sim.status to running from paused, and the fraction advances again", async () => {
  await openBareRun(h, { challenge: BARE, paused: true });

  const opened = await h.snapshot();
  assertNotNull(
    opened.sim,
    "startRun leaves a live run, held at its settle by setPaused",
  );
  assertEqual(
    opened.sim?.status,
    "paused",
    "the run is paused, which is the status this point presses play in",
  );

  await advanceCycles(h, HELD_CYCLES);

  const held = await h.snapshot();
  assertEqual(
    held.sim?.status,
    "paused",
    "game time does not resume a paused run",
  );
  assertEqual(
    held.sim?.cycle,
    0,
    `${HELD_CYCLES} cycles of game time complete no cycle while the run is paused`,
  );
  assertNear(
    held.sim?.fraction ?? -1,
    0,
    FRACTION_TOLERANCE,
    "the fraction stands where the pause left it, which is what the press then releases",
  );

  const [resumed, later] = await captureReplay(h, "resumed", async () => {
    await playAction(h);
    const first = await h.snapshot();
    await advanceFraction(h, RESUMED, 6);
    return [first, await h.snapshot()] as const;
  });

  assertEqual(
    resumed.sim?.status,
    "running",
    "play toggles a paused run to running",
  );
  assertEqual(
    later.sim?.cycle,
    0,
    "half a cycle of game time crosses no boundary, so the run is still inside cycle 0",
  );
  assertNear(
    later.sim?.fraction ?? -1,
    (resumed.sim?.fraction ?? -1) + RESUMED,
    FRACTION_TOLERANCE,
    `the fraction advances with game time again, by exactly the ${RESUMED} of a cycle driven`,
  );
});
