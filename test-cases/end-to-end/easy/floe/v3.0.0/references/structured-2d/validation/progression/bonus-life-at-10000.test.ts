// progression/bonus-life-at-10000 — the award that carries the score through ten
// thousand points pays a life, and the same award short of it pays none.
//
// specs/progression.md: "The score earns a life at every `BONUS_LIFE_EVERY`
// (`10,000`) points it crosses through play: `lives` rises by one for each boundary
// the score passes."
//
// TWO HOPS ARE TAKEN, ALIKE IN EVERY WAY BUT THE SCORE THEY WERE PAID ON TOP OF.
// Both are accepted hops onto a row this crossing has not reached, so
// specs/scoring.md pays `SCORE_ROW` (`10`) for each of them; the only difference is
// where the score stood when the award landed. Without the first hop this point
// would pass a build that paid a life for EVERY award, which is a build that has not
// implemented the boundary at all.
//
// THE SCORE IS POSED, NOT PLAYED FOR, AND THE AWARD IS NOT. `setScore` "grants no
// bonus life: a bonus life belongs to the scoring path, and a posed score is a
// precondition" (specs/instrumentation.md, graded by
// `instrumentation/set-score-grants-no-life`), so the pose can be dropped exactly one
// row award short of the boundary and the game's OWN award left to carry it across.
// Nothing has to be played to ten thousand points, and the pose itself cannot be what
// paid the life.
//
// `BONUS_LIFE_EVERY - SCORE_ROW` IS THE DISTINGUISHING VALUE: one row award lands the
// score exactly ON the boundary. A build that pays at every boundary reads one life
// more; a build that pays only ABOVE a boundary rather than on it reads none, and
// fails naming the boundary it did not count.
//
// THE HOPS ARE REAL HOPS rather than poses, because the award is a consequence of the
// game's own hop (specs/scoring.md) and posing the critter onto a row would pay
// nothing at all. They are taken up the emptied ice band from the near shore, where
// `startCrossing` leaves the critter: nothing on that strait can refuse a hop and
// nothing on it can cost a life, so the only thing that moves the counter is the
// award.

import { afterEach, beforeEach, it } from "vitest";
import { BONUS_LIFE_EVERY, SCORE_ROW } from "../constants";
import { assertEqual, assertGreaterThan, assertTrue } from "../assert";
import {
  captureReplay,
  createHarness,
  hop,
  startCrossing,
  ticksFor,
  type Harness,
} from "../harness";

/**
 * The score posed before the second hop: one row award short of a boundary.
 *
 * specs/scoring.md pays `SCORE_ROW` (`10`) for "a newly reached row", so a score of
 * `BONUS_LIFE_EVERY - SCORE_ROW` is carried exactly onto `BONUS_LIFE_EVERY` by one
 * such award.
 */
const POSED_SCORE = BONUS_LIFE_EVERY - SCORE_ROW;

/**
 * A quarter second of held strait between the two hops.
 *
 * It is longer than `HOP_COOLDOWN` (`0.12` s), so the second hop is offered a critter
 * that may hop again (specs/hopping.md), and it gives the replay a moment of strait
 * between the two.
 */
const GAP_FRAMES = ticksFor(0.25);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("pays a life on the award that crosses ten thousand, and none on the one that does not", async () => {
  startCrossing(h);

  const measured = await captureReplay(h, "bonus", async () => {
    // The control: a scoring hop taken with the score far from any boundary.
    const beforePlain = h.snapshot();
    const plainMoved = await hop(h, "up");
    const plain = h.snapshot();

    await h.advance(GAP_FRAMES);

    // The measurement: the same scoring hop, taken one award short of the boundary.
    h.debug.setScore(POSED_SCORE);
    const beforeBonus = h.snapshot();
    const bonusMoved = await hop(h, "up");
    const bonus = h.snapshot();

    return { beforePlain, plain, plainMoved, beforeBonus, bonus, bonusMoved };
  });

  // The situation both readings were taken in: each hop really was accepted and paid
  // a row award, and the first really did cross no boundary.
  assertTrue(measured.plainMoved, "the first hop was accepted");
  assertTrue(measured.bonusMoved, "the second hop was accepted");
  assertGreaterThan(
    measured.plain.score - measured.beforePlain.score,
    0,
    "the first hop reached a new row and was paid for it",
  );
  assertEqual(
    Math.floor(measured.plain.score / BONUS_LIFE_EVERY),
    0,
    "the first hop's award crossed no bonus-life boundary",
  );
  assertEqual(
    measured.beforeBonus.score,
    POSED_SCORE,
    "the posed score, one row award short of the boundary",
  );
  assertEqual(
    measured.bonus.score,
    BONUS_LIFE_EVERY,
    "the second hop's row award carried the score onto the boundary",
  );

  assertEqual(
    measured.plain.lives - measured.beforePlain.lives,
    0,
    "an award that crosses no boundary pays no life (specs/progression.md)",
  );
  assertEqual(
    measured.bonus.lives - measured.beforeBonus.lives,
    1,
    `the one life the score earns at ${BONUS_LIFE_EVERY} (specs/progression.md)`,
  );
});
