// press/harvest-starts-the-wave — there is no send control; the harvest is what
// launches the wave.
//
// TWO CLAIMS, AND THE FIRST ONE IS AN ABSENCE. `specs/campaign.md` makes the
// build phase untimed: it shows no countdown, it never starts a wave on its own,
// and the Load waits. A build with a timer behind the phase takes the decision
// away from the player at whatever moment it runs out, so the phase is sat in for
// a long stretch of simulation first and the yard is read to be still waiting.
//
// The second is the commitment. `specs/scrap-press.md` makes committing the
// harvest the thing that starts the wave, and a level cannot advance without one.
// So a candidate is kept, and the phase and the wave counter move on that call.

import { ConstantClock } from "@clockwyrks/simple-2d";
import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureReplay,
  createHarness,
  openYard,
  standCandidate,
  type Harness,
} from "../harness";

/**
 * The frame rate the wait is driven at: `10` Hz, a twelfth of this project's
 * default.
 *
 * What the wait watches for is an ABSENCE — a build phase that starts no wave of
 * its own — and nothing read across it is a position, a projectile or anything
 * else whose reading a step size bounds. `specs/instrumentation.md` fixes no frame
 * size and guarantees that an interval of simulation time reaches the same state
 * however it was divided into frames, which `instrumentation/frame-division-movement`
 * and `instrumentation/frame-division-projectile` are the two items that decide.
 * So the same ten seconds of untimed build phase are covered by a hundred frames
 * rather than twelve hundred, and the span the requirement is stated over is
 * unchanged.
 */
const WAIT_HZ = 10;

/** Frames of that clock covering `s` seconds of simulation, rounded up. */
function waitFrames(seconds: number): number {
  return Math.ceil(seconds * WAIT_HZ);
}

/** How long the untimed build phase is sat in before anything is committed. */
const WAIT_SECONDS = 10;

/** The roll that commits the harvest, and where it lands. */
const ROLLS = { type: "capacitor", quality: 1 } as const;
const AT = { col: 20, row: 10 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness({ clock: new ConstantClock(1000 / WAIT_HZ) });
});

afterEach(() => {
  h?.dispose();
});

it("waits for the harvest, and starts the wave on it", async () => {
  openYard(h);
  const opened = h.snapshot();
  assertEqual(opened.phase, "build", "the phase a run opens on");
  assertEqual(opened.wave, 0, "the wave counter before the first harvest");

  const driven = await captureReplay(h, "launch", async () => {
    // The phase is untimed: a long stretch of simulation starts nothing.
    await h.advance(waitFrames(WAIT_SECONDS));
    const waited = h.snapshot();

    const candidate = standCandidate(
      h,
      ROLLS.type,
      ROLLS.quality,
      AT.col,
      AT.row,
    );
    h.debug.keep(candidate);
    const launched = h.snapshot();

    await h.advance(waitFrames(2));
    return { waited, launched };
  });

  assertEqual(
    driven.waited.phase,
    "build",
    `the phase after ${WAIT_SECONDS}s of an untimed build phase`,
  );
  assertEqual(
    driven.waited.wave,
    opened.wave,
    `the wave counter after ${WAIT_SECONDS}s of an untimed build phase`,
  );
  assertEqual(
    driven.waited.waveActive,
    false,
    `a wave running after ${WAIT_SECONDS}s of an untimed build phase`,
  );

  assertEqual(
    driven.launched.phase,
    "wave",
    "the phase once the level's harvest was committed",
  );
  assertEqual(
    driven.launched.wave,
    opened.wave + 1,
    "the wave the harvest launched",
  );
});
