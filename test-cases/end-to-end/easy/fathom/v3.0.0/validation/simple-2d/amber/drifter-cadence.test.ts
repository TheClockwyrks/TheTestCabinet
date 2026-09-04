// amber/drifter-cadence — drifters are admitted on the DRIFTER_INTERVAL cadence.
//
// specs/gameplay.md: "While plankton remain in the maze, drifters are admitted at
// the den gate on a cadence of `DRIFTER_INTERVAL` (`25 s`)." The figure is what
// paces the bluff: a maze that tops itself up every few seconds hands the player
// a stream of free bonuses, and one that never does takes the second amber light
// out of the game.
//
// THE READING IS THE GAP BETWEEN CONSECUTIVE ADMISSIONS, not the time to the
// first. When the cadence's own clock starts is not something specs/gameplay.md
// fixes — a build is free to arm it at the top of a dive or at the moment a maze
// is laid out — so the first admission is used only as an origin, and the two
// gaps after it are what this point asserts.
//
// THE MAZE IS EMPTIED OF DRIFTERS AFTER EACH ADMISSION, so `DRIFTER_MAX` (`2`)
// never stops the cadence. `clearDrifters` is what does it, and it is the right
// operation for the job: specs/instrumentation.md has it take every drifter off
// the maze WITHOUT eating any, and says in as many words that "the cadence tops
// the maze back up on its own schedule from there" — so it leaves the very clock
// this point is timing untouched. Eating them instead would put the forager on
// whatever tile the admission chose, and specs/gameplay.md fixes only that a
// drifter arrives "at the den gate" rather than which tile that is, so the check
// would depend on a layout decision the specification leaves to the build.
//
// THE BOARD IS THE GAME'S OWN, because the cadence runs on the maze the build laid
// out and its condition is that "plankton remain" there. The roster is taken off
// it, which specs/instrumentation.md's `clearPredators` does without touching the
// plankton: over the seventy-odd seconds this watches, a released hunter would
// otherwise reach the forager and end the dive under the measurement.
//
// THE WAIT IS SKIPPED AND THE ARRIVAL IS POLLED. Most of each interval is run off
// camera in one call; only the last stretch is stepped finely, so the moment an
// admission lands is read to a twentieth of a second — well inside the tenth of a
// second this point allows.

import { afterEach, beforeEach, it } from "vitest";

import {
  assertEqual,
  assertGreaterThan,
  assertLessThanOrEqual,
} from "../assert";
import { DRIFTER_INTERVAL } from "../constants";
import {
  captureReplay,
  createHarness,
  startPlaying,
  type Harness,
} from "../harness";
import { ticks } from "../harness";

/** How many admissions are timed: an origin, and the two gaps this point asserts. */
const ADMISSIONS = 3;

/** How much of each interval is run off camera before the fine polling begins. */
const SKIP_SECONDS = DRIFTER_INTERVAL - 2;

/** Ticks of that coarse wait. */
const SKIP_TICKS = ticks(SKIP_SECONDS);

/** How long the fine polling waits for the admission, in ticks: four seconds. */
const POLL_TICKS = ticks(4);

/** How often it reads, in ticks: a twentieth of a second. */
const POLL_STEP = 6;

/** The item's own tolerance on the gap between two admissions, in seconds. */
const GAP_TOLERANCE = 0.1;

/** Ticks of live play the clip carries around the last admission. */
const CLIP_TICKS = 60;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("admits drifters DRIFTER_INTERVAL apart while plankton remain", async () => {
  const opened = await startPlaying(h);
  // The roster off the board, so nothing can reach the forager across the
  // seventy-odd seconds this measures. The plankton are left exactly as the maze
  // was laid out with them, because the cadence runs only while they remain.
  h.debug.clearPredators();
  h.debug.clearDrifters();
  assertGreaterThan(
    opened.planktonRemaining,
    0,
    "plankton left in the maze the cadence is timed on, which is the " +
      "condition specs/gameplay.md admits a drifter under",
  );

  /** Wait out one interval and report the simulated time the admission landed at. */
  const nextAdmission = async (): Promise<number | null> => {
    await h.skip(SKIP_TICKS);
    for (let spent = 0; spent < POLL_TICKS; spent += POLL_STEP) {
      await h.advance(POLL_STEP);
      const seen = h.snapshot();
      if (seen.drifters.length > 0) return seen.simTime;
    }
    return null;
  };

  const at: number[] = [];
  for (let admission = 0; admission < ADMISSIONS - 1; admission += 1) {
    const landed = await nextAdmission();
    assertEqual(
      landed !== null,
      true,
      `a drifter was admitted inside ${String(SKIP_SECONDS + 4)} s of the ` +
        `previous one, on the DRIFTER_INTERVAL (${String(DRIFTER_INTERVAL)} s) ` +
        "cadence (specs/gameplay.md)",
    );
    if (landed === null) return;
    at.push(landed);
    h.debug.clearDrifters();
  }

  const last = await captureReplay(h, "cadence", async () => {
    const landed = await nextAdmission();
    await h.advance(CLIP_TICKS);
    return landed;
  });
  assertEqual(
    last !== null,
    true,
    `a drifter was admitted inside ${String(SKIP_SECONDS + 4)} s of the ` +
      "previous one (specs/gameplay.md)",
  );
  if (last === null) return;
  at.push(last);

  for (let gap = 1; gap < at.length; gap += 1) {
    assertLessThanOrEqual(
      Math.abs(at[gap] - at[gap - 1] - DRIFTER_INTERVAL),
      GAP_TOLERANCE,
      `how far the ${(at[gap] - at[gap - 1]).toFixed(2)} s between admission ` +
        `${String(gap)} and admission ${String(gap + 1)} sits from ` +
        `DRIFTER_INTERVAL (${String(DRIFTER_INTERVAL)} s), measured on the ` +
        "simulation's own accumulated time (specs/gameplay.md)",
    );
  }
});
