// audio/extra-ship-cue — the cue an awarded ship plays.
//
// `specs/audio.md` fixes `extra-life` (`CUES.extraLife`) as the cue played when
// "An extra ship is granted", and `specs/scoring.md` fixes when that is: one extra
// ship is granted each time the score crosses a multiple of `EXTRA_LIFE_STEP`
// (`10 000`) through play. Both sentences matter here — the award is on the
// crossing, and the crossing has to be EARNED, since `setScore` grants no extra
// ship whatever boundary it crosses (`specs/instrumentation.md`).
//
// SO THE CROSSING IS SHOT FOR. The score is posed one Small short of the boundary
// and a real Small is then destroyed by a real round, so the payment that carries
// the score over it is the build's own scoring path and the award is the build's
// own rule.
//
// THE CROSSING TICK RAISES TWO CUES, AND ONLY ONE OF THEM IS READ HERE.
// `specs/audio.md`: "a tick that raises more than one of them plays each of those
// once" — the destruction raises `shatter` and the award raises `extra-life` on the
// same tick. The bus announces a play BY NAME, so this point reads `extra-life`
// alone and `audio/shatter-cue` reads the other; a build that plays only the
// shatter cue fails here on a count of zero, naming exactly what it left out.
//
// THE QUIET WINDOW IS THE HALF A BUILD CANNOT FAKE. The score sits one Small short
// of the boundary for a quarter second before the round is placed, and the round
// then crosses the gap: a build that plays the award cue when the score merely
// NEARS a boundary, or on the tick the score was posed, sounds inside that window.
//
// WHAT THIS DOES NOT DECIDE. The ship itself, which is
// `lives/extra-ship-at-10000`'s; and the announcement on the field, which is
// `presentation/extra-ship-indication`'s.

import { afterEach, beforeEach, it } from "vitest";
import {
  CUES,
  EXTRA_LIFE_STEP,
  MUZZLE_SPEED,
  SCORE_SMALL,
} from "../../src/constants";
import { assertEqual } from "../assert";
import {
  aimedRound,
  captureStill,
  createHarness,
  poseBullet,
  poseRock,
  requireRock,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import { playedBeforeEvent, playedOnEvent, watchForEvent } from "./cues";

/**
 * Where the rock is posed, in logical field units.
 *
 * Far out from the star — about 420 units, where the well pulls at some 25 units
 * per second squared (`specs/gravity.md`) — so the round's flight is a straight
 * line to within hundredths of a unit. Clear of the ship, which `startPlaying`
 * leaves at rest at the safe point.
 */
const ROCK_X = 250;
const ROCK_Y = 200;

/** The quiet window driven on the posed rock before the round is placed. */
const QUIET_LEAD_TICKS = ticksFor(0.25);

/** The ticks the round is given to land, six times the flight it actually takes. */
const FLIGHT_TICKS = ticksFor(0.25);

/**
 * The score the crossing kill is taken from.
 *
 * One Small short of `EXTRA_LIFE_STEP`, so the `SCORE_SMALL` (`100`) that kill pays
 * carries the score across exactly one multiple and grants exactly one ship
 * (`specs/scoring.md`).
 */
const ONE_SMALL_SHORT = EXTRA_LIFE_STEP - SCORE_SMALL;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("plays CUES.extraLife on the tick a kill carries the score across 10,000, once", async () => {
  startPlaying(h);
  h.debug.setScore(ONE_SMALL_SHORT);
  const rock = poseRock(h, "small", ROCK_X, ROCK_Y);

  const award = await watchForEvent(
    h,
    (s) => !s.rocks.some((one) => one.id === rock),
    QUIET_LEAD_TICKS + FLIGHT_TICKS,
    {
      quietLead: QUIET_LEAD_TICKS,
      arm: () => {
        const target = requireRock(
          h.snapshot(),
          rock,
          "the Small whose destruction pays the crossing — addRock appends one " +
            "rock of the size named (specs/instrumentation.md)",
        );
        const round = aimedRound(target);
        poseBullet(h, round.x, round.y, round.vx, round.vy);
      },
    },
  );
  captureStill(h, "award");

  assertEqual(
    award.hit,
    true,
    `the posed Small was destroyed inside ${String(FLIGHT_TICKS)} ticks by a ` +
      `round placed on its doorstep and closing at ${String(MUZZLE_SPEED)} ` +
      "units per second (specs/collision.md)",
  );
  assertEqual(
    award.snapshot.score,
    EXTRA_LIFE_STEP,
    `the score after a ${String(SCORE_SMALL)}-point kill taken from ` +
      `${String(ONE_SMALL_SHORT)}, which is the crossing this point is about ` +
      "(specs/scoring.md)",
  );
  assertEqual(
    playedBeforeEvent(award, CUES.extraLife),
    0,
    `times CUES.extraLife played over the ${String(award.at - 1)} ticks before ` +
      `the crossing, with the score sitting at ${String(ONE_SMALL_SHORT)} and ` +
      "no boundary crossed — an extra ship is granted on the crossing, and " +
      "setScore grants none (specs/scoring.md, specs/instrumentation.md)",
  );
  assertEqual(
    playedOnEvent(award, CUES.extraLife),
    1,
    "times CUES.extraLife played on the tick the kill carried the score across " +
      `${String(EXTRA_LIFE_STEP)} — a cue is played on the tick its event ` +
      "happens and at most once on that tick, and a tick raising more than one " +
      "cue plays each of those once (specs/audio.md)",
  );
});
