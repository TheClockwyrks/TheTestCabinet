// Floe — audio/cue-bonus-life: the hop whose row award carries the score through
// a `BONUS_LIFE_EVERY` boundary sounds more than the same hop taken short of one.
//
// Cue NAMES are not observable outside an engineless build; see audio/cue-hop for
// the doctrine every check here rests on. A bonus life is earned by a SCORING
// hop, and `specs/ui.md` gives an accepted hop its own cue, so the hop that earns
// the life lawfully carries two cues and presence alone cannot tell it from the
// hop that earns nothing.
//
// WHAT CAN. Each cue is one defined sound, emitting the same number of sources
// every time it plays, so the hop that crosses the boundary emits strictly MORE.
// The check drives TWO hops that are alike in every other way: both are accepted
// hops onto a row this crossing has not reached, so `specs/scoring.md` pays
// `SCORE_ROW` for each, and the only difference is where the score stood when the
// award landed.
//
// THE DISTINGUISHING VALUE IS POSED, NOT PLAYED FOR. `specs/instrumentation.md`
// makes `setScore` a precondition that "grants no bonus life: a bonus life
// belongs to the scoring path", so posing the score one row award short of
// `BONUS_LIFE_EVERY` (`10,000`) and then letting the game's OWN award carry it
// across is the whole scenario — no crossing has to be played to ten thousand
// points, and nothing but the boundary differs between the two hops.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertGreaterThanOrEqual,
} from "../assert";
import { BONUS_LIFE_EVERY, SCORE_ROW, START_COL } from "../constants";
import {
  captureReplay,
  createHarness,
  hop,
  startCrossing,
  ticksFor,
  watchCues,
  type Harness,
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
 * points it crosses through play", and `specs/scoring.md` pays `SCORE_ROW`
 * (`10`) for "a newly reached row", so a score of `BONUS_LIFE_EVERY - SCORE_ROW`
 * is carried exactly onto the boundary by one such award.
 */
const POSED_SCORE = BONUS_LIFE_EVERY - SCORE_ROW;

/** A quarter second of held strait between the two hops. */
const GAP_TICKS = ticksFor(0.25);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("sounds more on the hop that crosses the bonus-life boundary", async () => {
  // An empty strait with the critter part-way up the ice band, and a score of
  // zero: the first hop's row award crosses no boundary.
  await startCrossing(h);
  await h.debug.addCritter(START_COL, START_ROW);
  await h.armAudio();

  const played = watchCues(h);
  const measured = await captureReplay(h, "bonus", async () => {
    // A scoring hop far from any boundary.
    const beforePlain = played.length;
    await hop(h, "up");
    const plain = played.length - beforePlain;
    const scored = await h.snapshot();

    const beforeGap = played.length;
    await h.advance(GAP_TICKS);
    const gap = played.length - beforeGap;

    // The same scoring hop, taken one award short of the boundary.
    await h.debug.setScore(POSED_SCORE);
    const posed = await h.snapshot();
    const beforeBonus = played.length;
    await hop(h, "up");
    const bonus = played.length - beforeBonus;
    const crossed = await h.snapshot();

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

  assertEqual(measured.gap, 0, "no sound on the held strait between the hops");
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

  assertGreaterThan(
    measured.bonus,
    measured.plain,
    `the boundary-crossing hop plays the bonus-life cue on top of the hop's ` +
      `(${measured.plain} sound(s) on the hop that crossed none)`,
  );
});
