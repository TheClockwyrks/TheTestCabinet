// Meltdown — surge/vent-drawn-from-the-seed: which vent each unit enters at comes
// from the seeded generator, and replays.
//
// THE RULE. `specs/waves.md`: "Each unit's vent is drawn from the game's seeded
// generator, the two vents equally likely. That draw is the only randomness in
// the game, so a run replayed from the same seed releases the same sequence of
// vents." `specs/instrumentation.md` adds the property that makes it testable:
// randomness "runs off a generator seeded from the state's generator field, and
// it keeps its whole generator state in that field, so reseeding and replaying
// the same calls reproduces the same result exactly", and `reset`'s seed
// "defaults to `DEFAULT_SEED` (`1`)".
//
// TWO READINGS, AND EACH CATCHES WHAT THE OTHER LETS THROUGH.
//
//   BOTH VENTS ARE USED. A build that sent every unit through one vent is a
//   completely different game — one corridor to defend rather than two — and it
//   is a perfectly deterministic one, so a replay check alone would pass it. Over
//   forty draws at "equally likely", a generator that ever chose the other vent
//   would have to be extraordinarily unlucky to hide it: a fair coin comes up the
//   same way forty times once in five hundred billion.
//
//   THE SEQUENCE REPLAYS. The same wave is opened twice, both times through
//   `reset`, which reseeds everything from `DEFAULT_SEED` when no seed is named
//   — so the two runs are the same run, and the two vent sequences must be the
//   same sequence, entry for entry. A build that drew its vents from
//   `Math.random`, or from the wall clock, or from anything it did not keep in the
//   generator field, produces two different sequences and is named by the pair.
//   That is the property the whole debug surface rests on
//   (`specs/instrumentation.md`: "Given the same seed and the same sequence of
//   calls and elapsed game time, the game reaches the same state every time"), and
//   this is the item that reads it on the one draw the game actually makes.
//
// WAVE 4 IS THE ONE READ: `specs/waves.md` makes it a wave of forty units, which
// is the largest sample of draws the game offers before the milestone. Each unit
// is recorded the first time it is seen, in that order, so the sequence is the
// release order rather than whatever order a roster happens to hold
// (`surge/roster.ts`).
//
// WHAT THIS ITEM DOES NOT DECIDE. That the two vents come up in any particular
// proportion — "equally likely" is a distribution, and forty draws cannot decide
// one — nor which vent any particular unit gets. What is decided is that both are
// reachable and that the draw is reproducible.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertContains,
  assertDeepEqual,
  assertGreaterThanOrEqual,
} from "../assert";
import { DEFAULT_SEED, waveSize } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { openWave, releaseSeconds, watchRelease, type Arrival } from "./roster";

/** The run and the wave read: the forty-unit wave of a twenty-wave run. */
const WAVE_COUNT = 20;
const WAVE = 4;
const UNITS = waveSize(WAVE, WAVE_COUNT);

/** How long each of the two runs is watched, in seconds of game time. */
const WATCH_SECONDS = releaseSeconds(UNITS);

/**
 * The fewest draws the pair must be compared over.
 *
 * Two sequences of one entry match by luck one time in two; over the forty this
 * wave releases, two generators that are not the same generator match one time in
 * a million million. This is the floor below which the comparison could not have
 * decided anything, not an assertion about the wave's size, which is
 * `surge/wave-size`'s.
 */
const MIN_DRAWS = 8;

/** The vent sequence one run drew, in release order. */
function vents(arrivals: readonly Arrival[]): string[] {
  return arrivals.map((arrival) => arrival.vent);
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("draws both vents and draws the same sequence twice from one seed", async () => {
  await openWave(h, WAVE);
  const first = vents(await watchRelease(h, WATCH_SECONDS));
  const firstPending = (await h.snapshot()).wavePending;
  await captureStill(h, "vents");

  await openWave(h, WAVE);
  const second = vents(await watchRelease(h, WATCH_SECONDS));
  const secondPending = (await h.snapshot()).wavePending;

  assertDeepEqual(
    [firstPending, secondPending],
    [0, 0],
    "units each of the two runs still had left to release once the whole " +
      "cadence had run: the sequences are compared over a finished release",
  );
  assertGreaterThanOrEqual(
    first.length,
    MIN_DRAWS,
    "precondition: vent draws the first run released, to compare a second " +
      "against",
  );
  assertContains(
    first,
    "left",
    "the left vent among the vents the seeded draw chose over " +
      `${first.length} units (specs/waves.md: the two vents equally likely)`,
  );
  assertContains(
    first,
    "top",
    "the top vent among the vents the seeded draw chose over " +
      `${first.length} units (specs/waves.md: the two vents equally likely)`,
  );
  assertDeepEqual(
    second,
    first,
    `the vent sequence a second run at seed ${DEFAULT_SEED} drew, which ` +
      "specs/waves.md makes identical to the first's",
  );
});
