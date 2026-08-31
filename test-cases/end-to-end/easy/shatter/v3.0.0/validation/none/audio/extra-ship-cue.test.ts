// audio/extra-ship-cue — the cue an awarded ship plays.
//
// `specs/audio.md` fixes `extra-life` (`CUES.extraLife`) as the cue played when
// "An extra ship is granted", and `specs/scoring.md` fixes when that is: "One extra
// ship is granted each time the score crosses a multiple of `EXTRA_LIFE_STEP`
// (`10 000`) through play". Both sentences matter here — the award is on the
// crossing, and the crossing has to be earned, since `setScore` "grants no extra
// ship, whatever multiple of `EXTRA_LIFE_STEP` it carries the score across"
// (`specs/instrumentation.md`).
//
// SO THE CROSSING IS SHOT FOR. The score is posed one Small short of the boundary
// and a real Small is then destroyed by a real round, so the payment that crosses
// it is the build's own scoring path.
//
// AND THE WHOLE DESIGN OF THIS CHECK IS THE COMPARISON. The crossing tick is a
// destruction AND an award, and `specs/audio.md` puts both cues on it: "a tick that
// raises more than one of them plays each of those once". Under this engine a sound
// carries no name (`./cues.ts`), so a check that asked only whether the crossing
// tick sounded would be answered by `CUES.shatter` alone and would pass a build
// that never plays `CUES.extraLife` at all. An ORDINARY kill is therefore taken
// first, on a score nowhere near a boundary, and what it sounds is the measured
// cost of a rock coming apart on this build. The crossing kill is the same kill on
// the same rock in the same place, and its tick has to sound MORE: whatever the
// shatter cue is worth in sources, the crossing tick carries it plus a cue the
// ordinary one did not.
//
// THAT COMPARISON FIXES NO NUMBER OF SOURCES PER CUE, which `./cues.ts` explains is
// the build's business and not the specification's — a cue made of a tone and a
// noise burst is two sources, and both kills carry the same shatter whatever that
// number is. The only build it rejects is one whose crossing tick carries nothing
// the ordinary one did not, which is a build that played no extra-life cue.
//
// WHAT THIS DOES NOT DECIDE. The ship itself, which is `lives/extra-ship-at-10000`'s;
// the announcement on the field, which is `presentation/extra-ship-indication`'s;
// and the cue's NAME, which is not observable here.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertGreaterThanOrEqual,
} from "../assert";
import { EXTRA_LIFE_STEP, SCORE_SMALL } from "../constants";
import {
  captureStill,
  createHarness,
  fireAt,
  poseRock,
  requireRock,
  rockById,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import { soundsBeforeEvent, soundsOnEvent, watchForEvent } from "./cues";

/**
 * Where both rocks are posed, in logical field units.
 *
 * Far out from the star — about 420 units, where the well pulls at some 25 units
 * per second squared — so a round's flight is a straight line to within hundredths
 * of a unit, and the two kills are the same kill in the same place. Clear of the
 * ship, which `startPlaying` leaves at rest at the safe point.
 */
const ROCK_X = 250;
const ROCK_Y = 200;

/** The quiet window driven on each posed rock before its round is placed. */
const QUIET_LEAD_TICKS = ticksFor(0.25);

/** The ticks each round is given to land, six times the flight it actually takes. */
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

afterEach(async () => {
  await h.dispose();
});

/** Pose a Small at the shared spot, shoot it down, and report what each tick sounded. */
async function shootOneSmall(harness: Harness) {
  const rock = await poseRock(harness, "small", ROCK_X, ROCK_Y);
  return watchForEvent(
    harness,
    (s) => rockById(s, rock) === undefined,
    QUIET_LEAD_TICKS + FLIGHT_TICKS,
    {
      quietLead: QUIET_LEAD_TICKS,
      arm: async () => {
        await fireAt(
          harness,
          requireRock(await harness.snapshot(), rock, "audio/extra-ship-cue"),
        );
      },
    },
  );
}

it("sounds more on the tick a kill crosses 10,000 than the same kill does otherwise", async () => {
  await startPlaying(h);
  // A genuine, browser-trusted gesture: an engineless build's audio does not start
  // until the player has interacted with the page (`specs/audio.md`), and the key
  // is bound to nothing (`specs/controls.md`).
  await h.armAudio();

  // The ordinary kill, from a score nowhere near a boundary.
  const ordinary = await shootOneSmall(h);
  assertEqual(
    ordinary.hit,
    true,
    `the first posed Small was destroyed inside ${String(FLIGHT_TICKS)} ticks by ` +
      "a round placed on its doorstep (specs/collision.md)",
  );
  assertEqual(
    soundsBeforeEvent(ordinary),
    0,
    `sounds the build emitted over the ${String(ordinary.at - 1)} ticks before the ` +
      "ordinary kill, which specs/audio.md names no event for",
  );
  const plain = soundsOnEvent(ordinary);
  assertGreaterThanOrEqual(
    plain,
    1,
    "sounds the build emitted on the tick of an ordinary kill, which is the " +
      "CUES.shatter the crossing kill below is measured against — " +
      "audio/shatter-cue is the point that requirement belongs to " +
      "(specs/audio.md)",
  );

  // The same kill again, one Small short of the boundary.
  await h.debug.setScore(ONE_SMALL_SHORT);
  const award = await shootOneSmall(h);
  await captureStill(h, "award");

  assertEqual(
    award.hit,
    true,
    `the second posed Small was destroyed inside ${String(FLIGHT_TICKS)} ticks ` +
      "by a round placed on its doorstep (specs/collision.md)",
  );
  assertEqual(
    award.snapshot.score,
    EXTRA_LIFE_STEP,
    `the score after a ${String(SCORE_SMALL)}-point kill taken from ` +
      `${String(ONE_SMALL_SHORT)}, which is the crossing this point is about ` +
      "(specs/scoring.md)",
  );
  assertEqual(
    soundsBeforeEvent(award),
    0,
    `sounds the build emitted over the ${String(award.at - 1)} ticks before the ` +
      "crossing kill, on the same emptied field the ordinary one was taken on",
  );
  assertGreaterThan(
    soundsOnEvent(award),
    plain,
    `sounds the build emitted on the tick its kill carried the score across ` +
      `${String(EXTRA_LIFE_STEP)}, against the ${String(plain)} the same kill ` +
      "sounded with no boundary crossed — the crossing tick carries CUES.extraLife " +
      "on top of the CUES.shatter both kills raise (specs/audio.md)",
  );
});
