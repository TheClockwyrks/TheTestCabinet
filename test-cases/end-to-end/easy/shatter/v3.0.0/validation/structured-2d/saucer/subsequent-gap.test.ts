// saucer/subsequent-gap — the wait between one saucer leaving and the next
// arriving.
//
// THE RULE. `specs/saucer.md`, The cadence: each later arrival comes
// "`SAUCER_GAP_MIN` to `SAUCER_GAP_MAX` (`25` to `35` seconds), drawn uniformly,
// after the previous saucer leaves". The interval is measured from the DEPARTURE,
// not from the arrival, so a build that measures its gap from one arrival to the
// next runs `SAUCER_LIFETIME` (`12` s) short and fails here.
//
// WHAT IS READ. The game time of the first sample reporting the slot clear after
// the first visit, and the game time of the first sample reporting the second
// visit. Three seeds, because the wait is a uniform draw: one seed reads one draw,
// and a build that always waits a fixed time inside the band would be indis-
// tinguishable from a conformant one on a single reading anyway — what three seeds
// buy is that a build whose draw runs outside the band on part of its range is
// caught rather than sampled around.
//
// BOTH ENDS ARE ASSERTED, because both are the rule: a build that comes straight
// back fails the low end and a build that makes the player wait a minute fails the
// high one.
//
// THE GAME IS REALLY OPENED and held quiet, so the two visits are the game's own
// arrivals rather than posed ones — a posed saucer is a precondition and says
// nothing about a cadence. See `visits.ts`.
//
// WHAT THIS DOES NOT DECIDE. The first arrival, which is
// `saucer/first-arrives-at-18s`'s, and the length of a visit, which is
// `saucer/despawns-after-12s`'s.

import { afterEach, it } from "vitest";
import { SAUCER_GAP_MAX, SAUCER_GAP_MIN } from "../constants";
import { assertBetween, assertEqual, assertTrue } from "../assert";
import { captureStill, type Harness } from "../harness";
import {
  createMarchHarness,
  MARCH_STEP,
  marchFrames,
  openQuietGame,
  watchVisits,
} from "./visits";

/** The three seeds the gap is drawn under. */
const SEEDS = [1, 2, 3] as const;

/**
 * How long each seed's game is watched for, in seconds of game time.
 *
 * The longest a conformant build can take to reach the second arrival is the
 * `18` s first delay, the `12` s visit, and the `35` s upper gap — `65` s. Five
 * more is margin for a build whose clocks run a shade slow, so a run that never
 * reaches a second visit is reported as exactly that rather than as a gap out of
 * range.
 */
const WATCH_SECONDS = 70;

/**
 * How far outside the stated band a reading may fall, in seconds.
 *
 * One marched frame. The departure and the arrival are each read on the first
 * sample that shows them, so each is up to one frame late and the difference of
 * the two is out by at most one frame either way. It is a reading allowance
 * rather than room on the figure: at a fifteenth of a second it is a
 * hundred-and-fiftieth of the ten-second band the rule leaves.
 */
const READING_SLACK = MARCH_STEP;

let h: Harness;

afterEach(() => {
  h?.dispose();
});

it.each(SEEDS)(
  "waits 25 to 35 seconds after a saucer leaves before the next arrives (seed %i)",
  async (seed) => {
    h = await createMarchHarness();
    const opened = await openQuietGame(h, seed);

    const watch = await watchVisits(h, marchFrames(WATCH_SECONDS) - opened, {
      done: (visits) => visits.length >= 2,
    });
    // The saucer that followed the gap, on the frame it arrived.
    captureStill(h, "gap");

    assertEqual(
      watch.visits.length,
      2,
      `saucer visits inside ${WATCH_SECONDS} s of game time on seed ${seed} — ` +
        `the first is due at 18 s and the second at most 12 + ${SAUCER_GAP_MAX} s ` +
        "after it (specs/saucer.md)",
    );
    const left = watch.visits[0].goneAt;
    assertTrue(
      left !== null,
      `the first saucer to have left the field before the second arrived on ` +
        `seed ${seed} — the gap is measured from the departure (specs/saucer.md)`,
    );

    assertBetween(
      watch.visits[1].seenAt - (left as number),
      SAUCER_GAP_MIN - READING_SLACK,
      SAUCER_GAP_MAX + READING_SLACK,
      `seconds of game time between the first saucer leaving and the second ` +
        `arriving on seed ${seed}, against the SAUCER_GAP_MIN..SAUCER_GAP_MAX ` +
        `(${SAUCER_GAP_MIN}..${SAUCER_GAP_MAX} s) specs/saucer.md draws it from`,
    );
  },
);
