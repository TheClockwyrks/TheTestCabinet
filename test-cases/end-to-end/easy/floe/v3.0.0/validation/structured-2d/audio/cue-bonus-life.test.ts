// Floe — audio/cue-bonus-life: the hop whose row award carries the score through a
// `BONUS_LIFE_EVERY` boundary plays the bonus-life cue, and the same hop taken
// short of one plays none.
//
// The cue is read BY NAME off the engine's bus; see audio/cue-hop for the reading
// every check in this directory rests on. A bonus life is earned by a SCORING
// hop, and `specs/ui.md` gives an accepted hop its own cue, so the hop that earns
// the life lawfully plays two cues and only the NAME separates them.
//
// THE HOP THAT CROSSES NOTHING IS THE CONTROL. Both hops are accepted hops onto a
// row this crossing has not reached, so `specs/scoring.md` pays `SCORE_ROW` for
// each, and the only difference between them is where the score stood when the
// award landed — so a build that plays the bonus-life cue on every award, or on
// every hop, is heard on the first one.
//
// THE DISTINGUISHING VALUE IS POSED, NOT PLAYED FOR. `specs/instrumentation.md`
// makes `setScore` a precondition that "grants no bonus life: a bonus life belongs
// to the scoring path, and a posed score is a precondition", so posing the score
// one row award short of `BONUS_LIFE_EVERY` (`10,000`) and then letting the game's
// OWN award carry it across is the whole scenario — no crossing has to be played
// to ten thousand points, and nothing but the boundary differs between the two
// hops.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertGreaterThanOrEqual,
  assertLength,
} from "../assert";
import {
  BONUS_LIFE_EVERY,
  CUES,
  SCORE_ROW,
  START_COL,
} from "../../src/constants";
import {
  captureReplay,
  createHarness,
  hop,
  startCrossing,
  ticksFor,
  watchCues,
  type Harness,
  type TimedCue,
} from "../harness";

/**
 * The ice-band row the critter is stood on to hop up from.
 *
 * Any solid row with two clear rows above it decides the same rule; the middle of
 * the ice band is taken, and this strait carries no vehicle, so both hops are
 * accepted (`specs/hopping.md`).
 */
const START_ROW = 15;

/**
 * The score posed before the second hop: one row award short of a boundary.
 *
 * `specs/progression.md` earns a life "at every `BONUS_LIFE_EVERY` (`10,000`)
 * points it crosses through play", and `specs/scoring.md` pays `SCORE_ROW` (`10`)
 * for "a newly reached row", so a score of `BONUS_LIFE_EVERY - SCORE_ROW` is
 * carried exactly onto the boundary by one such award.
 */
const POSED_SCORE = BONUS_LIFE_EVERY - SCORE_ROW;

/**
 * A quarter second of held strait between the two hops.
 *
 * Twice `HOP_COOLDOWN` (`0.12` s), so the second hop is offered a critter whose
 * cooldown has reached `0` (`specs/hopping.md`).
 */
const GAP_TICKS = ticksFor(0.25);

/** How many times `cue` sounded in `played`, from index `from` on. */
function sounded(
  played: readonly TimedCue[],
  from: number,
  cue: string,
): number {
  return played.slice(from).filter((entry) => entry.cue === cue).length;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("plays the bonus-life cue on the hop that crosses the boundary, and not on the one short of it", async () => {
  // An empty strait with the critter part-way up the ice band, and a score of
  // zero: the first hop's row award crosses no boundary.
  startCrossing(h);
  h.debug.addCritter(START_COL, START_ROW);

  const played = watchCues(h);
  const measured = await captureReplay(h, "bonus", async () => {
    // A scoring hop far from any boundary.
    const beforePlain = played.length;
    await hop(h, "up");
    const plain = sounded(played, beforePlain, CUES.bonusLife);
    const scored = h.snapshot();

    const beforeGap = played.length;
    await h.advance(GAP_TICKS);
    const gap = sounded(played, beforeGap, CUES.bonusLife);

    // The same scoring hop, taken one award short of the boundary.
    h.debug.setScore(POSED_SCORE);
    const posed = h.snapshot();
    const beforeBonus = played.length;
    await hop(h, "up");
    const bonus = played
      .slice(beforeBonus)
      .filter((entry) => entry.cue === CUES.bonusLife);
    const crossed = h.snapshot();

    return { plain, scored, gap, posed, bonus, crossed };
  });

  // The first hop really paid a row award, and really crossed no boundary.
  assertGreaterThan(
    measured.scored.score,
    0,
    "the first hop reached a new row and was paid for it",
  );
  assertEqual(
    Math.floor(measured.scored.score / BONUS_LIFE_EVERY),
    0,
    "the first hop's award crossed no bonus-life boundary",
  );
  assertEqual(
    measured.plain,
    0,
    "no bonus-life cue on the hop that crossed no boundary",
  );
  assertEqual(
    measured.gap,
    0,
    "no bonus-life cue on the held strait between the hops",
  );
  assertEqual(
    measured.posed.score,
    POSED_SCORE,
    "the posed score stands one row award short of the boundary",
  );

  // The second hop's award really carried the score across it.
  assertGreaterThanOrEqual(
    measured.crossed.score,
    BONUS_LIFE_EVERY,
    "the second hop's row award carried the score through the boundary",
  );

  assertLength(
    measured.bonus,
    1,
    "bonus-life cues played on the hop that crossed the boundary",
  );
});
