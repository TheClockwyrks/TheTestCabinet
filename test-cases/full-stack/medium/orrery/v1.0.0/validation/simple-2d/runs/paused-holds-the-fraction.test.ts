// runs/paused-holds-the-fraction — game time advanced while the run is paused
// moves neither the cycle counter nor the fraction.
//
// THE RULE. "`sim.status` is one of `running`, `paused`, `faulted`, and
// `complete`. The fraction advances only while the status is `running`, so pausing
// holds it where it is" (`specs/simulation.md`, Cycles and the clock). The gate
// that holds the run's clock still is `setPaused(true)`, which
// `specs/instrumentation.md` tabulates for exactly this faculty and which "moves
// `sim.status` between `running` and `paused`, exactly as the `play` toggle moves
// it".
//
// THE CONFIGURATION. One piston at `(0, 0)` on the tape `extend`, so every cycle
// the run reaches changes something the snapshot reports; the field is empty, so
// nothing can collide. The run is left RUNNING first and driven `0.4` of a cycle,
// which is what makes this check's verdict a reading of a clock that was moving
// rather than of one that never moved: a build whose fraction stands still passes
// the second half of this check and fails the first.
//
// The pause is taken part way through a cycle on purpose. `0.4` is neither a
// boundary nor a collision sample, so a build that quietly rounded the held
// fraction to `0` — or ran the cycle it was in to its end before stopping — is
// caught by the same reading.
//
// THE VERDICT. After a further TWELVE cycles' worth of game time, spread over
// frames, `sim.cycle` and `sim.fraction` stand exactly where the pause left them,
// and `sim.status` is still `paused`. The fraction is read through `assertNear` at
// `FRACTION_TOLERANCE`, because `specs/instrumentation.md` carries `sim.fraction`
// as a running sum of the frames' own delta times, which "agree to within the
// rounding of that sum rather than bit for bit".

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear, assertNotNull } from "../assert";
import { ARM_MIN_LEN, FRACTION_TOLERANCE } from "../constants";
import { armPart, solution } from "../formats";
import { BARE, ORIGIN } from "../fixtures";
import {
  advanceCycles,
  advanceFraction,
  captureReplay,
  createHarness,
  openBareRun,
  pauseRun,
  type Harness,
} from "../harness";

/** How far into cycle `0` the run is paused: neither a boundary nor a sample. */
const PART_WAY = 0.4;

/** How much game time is handed to the paused run. */
const HELD_CYCLES = 12;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves sim.cycle and sim.fraction where they stood over twelve cycles of game time", async () => {
  await openBareRun(h, {
    challenge: BARE,
    machine: solution([
      armPart("piston", ORIGIN.q, ORIGIN.r, 0, ARM_MIN_LEN, ["extend"]),
    ]),
  });

  const opened = await h.snapshot();
  assertEqual(
    opened.sim?.status,
    "running",
    "startRun leaves the run running, which is the status the fraction advances under",
  );

  await advanceFraction(h, PART_WAY);

  const moving = await h.snapshot();
  assertEqual(moving.sim?.cycle, 0, "the run is still inside cycle 0");
  assertNear(
    moving.sim?.fraction ?? -1,
    PART_WAY,
    FRACTION_TOLERANCE,
    "the fraction advanced with game time while the status was running",
  );

  await pauseRun(h);

  const held = await h.snapshot();
  assertNotNull(held.sim, "the run is still live once paused");
  assertEqual(
    held.sim?.status,
    "paused",
    "setPaused(true) moves the status to paused, exactly as the play toggle does",
  );

  await captureReplay(h, "held", () => advanceCycles(h, HELD_CYCLES));

  const after = await h.snapshot();
  assertEqual(
    after.sim?.status,
    "paused",
    "game time does not resume a paused run",
  );
  assertEqual(
    after.sim?.cycle,
    held.sim?.cycle,
    `${HELD_CYCLES} cycles of game time complete no cycle while the status is paused`,
  );
  assertNear(
    after.sim?.fraction ?? -1,
    held.sim?.fraction ?? -1,
    FRACTION_TOLERANCE,
    "the fraction advances only while the status is running, so the pause holds it where it is",
  );
});
