// rocks/drift-speed-large — every Large a wave puts up drifts inside its range.
//
// `specs/rocks.md` gives a Large a base drift speed "drawn uniformly from its size's
// range", `ROCK_SPEED_MIN.large` to `ROCK_SPEED_MAX.large` (60 to 110), and
// `specs/progression.md` fixes what a wave does with it: each of wave N's rocks is
// "a Large's base drift speed multiplied by 1 + min(WAVE_SPEED_CAP,
// WAVE_SPEED_STEP * (N - 1))". This item reads the speeds a wave actually spawned
// with, against that range scaled by that wave's own multiplier.
//
// IT IS READ OFF A REAL WAVE, which is why this is one of the few checks in the
// suite that runs with the game's own wave loop ON. A Large reaches the field one
// way only — `specs/progression.md`'s wave — so a check that posed one with
// `addRock` would be reading a rock `specs/instrumentation.md` places AT REST and
// grading nothing at all. The run is opened the way a player opens one: `reset` to
// the title, then the confirm key on `PLAY`, which `specs/ui.md`
// makes the entry to a game. `reset` leaves both world gates on, so the opening
// wave is the build's own.
//
// EITHER OPENING IS ALLOWED FOR. `specs/progression.md` lets wave 1 put its rocks up
// at once OR run the `WAVE 1` banner first and spawn as it ends, so the check waits
// for the first tick that HAS rocks on it — up to a banner's `WAVE_BANNER_TIME`
// (1.5 s) and a second over — rather than reading a fixed moment. Polling every
// tick is what keeps the reading close to the spawn: it is the speed the wave gave
// each rock, not one a second of falling has changed.
//
// THREE GAMES, so the sample is a dozen rocks rather than four. The speeds are
// draws (`specs/simulation.md`), and a build drawing them from some other range
// would need to be unlucky to be caught by four samples from one game. Nothing is
// posed for the speed: `setNextRockSpeed` is how a check that wants a particular
// one gets it, and this check wants the build's own draws.
//
// THE MULTIPLIER IS TAKEN FROM THE WAVE THE BUILD REPORTS, not from the number 1,
// so this item grades the speed alone: whether the game opens on wave 1 at all is
// `waves/wave-one-spawns-four`'s and `waves/wave-number-increments`', and how the
// multiplier scales with the wave is `waves/speed-scales-per-wave`'s. It is floored
// at the first wave, since `specs/progression.md`'s formula is stated for wave 1
// onward.
//
// WHAT THIS DOES NOT DECIDE. How many rocks a wave puts up and where, which are the
// `waves/*` items'; and the Medium and Small ranges, which are read where those
// sizes actually enter the field — through the star's recycling, in
// `rocks/drift-speed-medium` and `rocks/drift-speed-small`.

import { afterEach, beforeEach, it } from "vitest";
import {
  ROCK_SPEED_MAX,
  ROCK_SPEED_MIN,
  WAVE_BANNER_TIME,
  WAVE_SPEED_CAP,
  WAVE_SPEED_STEP,
} from "../constants";
import { assertBetween, assertGreaterThan, assertTrue } from "../assert";
import { speedOf } from "../geometry";
import {
  captureStill,
  createHarness,
  rocksOf,
  startRun,
  ticksFor,
  type Harness,
} from "../harness";

/** How many games the opening wave is drawn in, so a dozen rocks are read. */
const GAMES = 3;

/**
 * How long a wave is waited for, in ticks.
 *
 * `specs/progression.md` allows wave 1 to spawn at once or as a `WAVE_BANNER_TIME`
 * (1.5 s) banner ends, so this is that with a second of room — long enough for
 * either opening and far short of anything else happening: `specs/saucer.md`'s
 * first arrival is at 18 seconds.
 */
const WAVE_WINDOW_TICKS = ticksFor(WAVE_BANNER_TIME + 1);

/**
 * How far outside the scaled range a spawn speed may fall: two percent, as the
 * review item states.
 *
 * Room for a build's own arithmetic and for the tick the reading lands on, not for
 * the environment. `specs/progression.md` spawns every rock at least
 * `WAVE_MIN_STAR_DIST` (200) from the star, where `specs/gravity.md`'s well adds at
 * most 0.94 units per second in the single tick the poll can be behind by — under
 * 1.6 percent of the slowest Large, so it fits inside this with room. The wrong
 * models it is set against are whole ranges away: a Medium's 90 to 150, or a Small's
 * 130 to 210.
 */
const TOLERANCE = 0.02;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("spawns every Large of a wave inside its range scaled by that wave's multiplier", async () => {
  for (let game = 1; game <= GAMES; game += 1) {
    // A real opening: the title screen, then PLAY.
    await startRun(h);

    const arrival = await h.until((snapshot) => snapshot.rocks.length > 0, {
      maxFrames: WAVE_WINDOW_TICKS,
      poll: 1,
    });
    captureStill(h, "wave");

    assertTrue(
      arrival.hit,
      `game ${game}: a wave of rocks on the field within ` +
        `${WAVE_BANNER_TIME + 1} seconds of a game opening — wave 1 spawns at ` +
        "once or as its banner ends (specs/progression.md)",
    );

    const wave = Math.max(1, arrival.snapshot.wave);
    // specs/progression.md: 1 + min(WAVE_SPEED_CAP, WAVE_SPEED_STEP * (N - 1)).
    const multiplier =
      1 + Math.min(WAVE_SPEED_CAP, WAVE_SPEED_STEP * (wave - 1));
    const spawned = rocksOf(arrival.snapshot, "large");

    assertGreaterThan(
      spawned.length,
      0,
      `game ${game}: Large rocks in the wave that arrived — a wave spawns ` +
        "Large rocks (specs/progression.md)",
    );

    for (const [index, rock] of spawned.entries()) {
      assertBetween(
        speedOf(rock),
        ROCK_SPEED_MIN.large * multiplier * (1 - TOLERANCE),
        ROCK_SPEED_MAX.large * multiplier * (1 + TOLERANCE),
        `game ${game}, rock ${index + 1} of wave ${wave}: the speed it ` +
          `spawned drifting at — a Large's base range, ` +
          `${ROCK_SPEED_MIN.large} to ${ROCK_SPEED_MAX.large} ` +
          "(specs/rocks.md), scaled by that wave's multiplier of " +
          `${multiplier.toFixed(2)} (specs/progression.md), within two percent`,
      );
    }
  }
});
