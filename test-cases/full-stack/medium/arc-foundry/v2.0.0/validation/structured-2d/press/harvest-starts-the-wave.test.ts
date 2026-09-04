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

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureReplay,
  createHarness,
  openYard,
  standCandidate,
  type Harness,
} from "../harness";

/** How long the untimed build phase is sat in before anything is committed. */
const WAIT_SECONDS = 10;

/** The roll that commits the harvest, and where it lands. */
const ROLLS = { type: "capacitor", quality: 1 } as const;
const AT = { col: 20, row: 10 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
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
    await h.advanceSeconds(WAIT_SECONDS);
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

    await h.advanceSeconds(2);
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
