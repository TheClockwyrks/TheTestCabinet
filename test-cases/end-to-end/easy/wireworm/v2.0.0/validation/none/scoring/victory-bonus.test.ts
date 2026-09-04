// scoring/victory-bonus — winning pays 250 for each life remaining.
//
// `specs/scoring.md`'s table: "The run is won" pays `SCORE_VICTORY`
// (`250 * lives`), "for the lives remaining", and the paragraph under it: "The
// victory bonus is paid on top of level `12`'s clear bonus."
// `specs/progression.md` fixes when a run is won: the last worm segment of level
// `TOTAL_LEVELS` (`12`) is removed.
//
// WHY THIS POINT READS A DIFFERENCE RATHER THAN A TOTAL. A victory pays three
// things at once — the kill, level 12's clear bonus, and the victory bonus — and
// a point asserting the total would be asserting all three, so a build with a
// correct victory bonus and a wrong clear bonus would fail both items and a grade
// could no longer say which one the build got wrong. Two runs are won instead,
// identical in every way but the lives remaining: the same level, the same board,
// the same one-segment worm shot the same way. The kill and the clear bonus are
// therefore the same in both, whatever this build pays for them, and the
// DIFFERENCE between what the two victories paid is `SCORE_VICTORY` for each of
// the two extra lives — the `500` the point names.
//
// THE TWO LIFE COUNTS ARE ORDINARY ONES, `1` and `3`. Neither is a boundary a
// build could be treating specially — `3` is `START_LIVES`, the count a run opens
// with, and `1` is the count a run plays its last life on — so the difference
// reads the per-life rate rather than some behaviour at zero.
//
// EACH RUN IS OPENED FROM `reset`, which `specs/instrumentation.md` says restores
// every declared field to its title-screen value, the score to `0` and the
// rosters to empty. That is what makes the second run a second run rather than a
// second victory posed on top of the first one's victory screen.
//
// The worms are posed with their faculties off, and the board holds nothing else:
// this point is about what a victory PAYS, not about where a worm walks.
//
// WHAT EVERY WRONG MODEL READS. A build that pays a flat victory bonus reads `0`;
// one that pays per life STARTED with rather than per life remaining reads `0`;
// one that pays no victory bonus reads `0` — and a build that pays for the lives
// but at the wrong rate reads twice whatever that rate is. The distinguishing
// figure is `500`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { SCORE_VICTORY, TOTAL_LEVELS } from "../constants";
import {
  captureStill,
  createHarness,
  poseWorm,
  startPlaying,
  type Harness,
} from "../harness";
import { shootInto } from "./payment";

/** The tile the run's last worm segment stands on. */
const LAST_SEGMENT = { c: 20, r: 8 };

/** The two life counts the two runs are won with. */
const FEWER_LIVES = 1;
const MORE_LIVES = 3;

/**
 * What those extra lives must add to the second victory's payment.
 *
 * There is no tolerance on it and there cannot be one: a score is a whole number
 * of points and `specs/scoring.md` fixes the figure exactly, so the assertion is
 * equality.
 */
const EXPECTED = SCORE_VICTORY * (MORE_LIVES - FEWER_LIVES);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

/**
 * Open a fresh run on level `12`, pose it down to its last worm segment with
 * `lives` in hand, shoot that segment away, and hand back what the win paid.
 */
async function winWith(lives: number): Promise<number> {
  await h.debug.reset();
  await startPlaying(h, { level: TOTAL_LEVELS });
  await h.debug.setLives(lives);
  await poseWorm(h, {
    c: LAST_SEGMENT.c,
    r: LAST_SEGMENT.r,
    segments: [LAST_SEGMENT],
    stepping: false,
    body: false,
  });

  const before = (await h.snapshot()).score;
  await shootInto(h, LAST_SEGMENT.c, LAST_SEGMENT.r);
  return (await h.snapshot()).score - before;
}

it("pays 250 for each life still in hand when the run is won", async () => {
  const onFewer = await winWith(FEWER_LIVES);
  const onMore = await winWith(MORE_LIVES);

  await captureStill(h, "scored");
  assertEqual(
    onMore - onFewer,
    EXPECTED,
    "the points two further lives added to the victory",
  );
});
