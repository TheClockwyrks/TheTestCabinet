// sortie/mismatch-scores-nothing — a mismatched shot adds nothing to the score.
//
// THE RULE. `specs/mode.md` (Sortie), of the wasted shot: it "adds nothing to the
// score and nothing to the resonance meter". `specs/scoring.md` agrees from the
// other side — it lists every event that pays, none of which is a shot, and closes
// with "Nothing else adds to the score. A shot that destroys no drone pays
// nothing."
//
// THE SCORE IS POSED AWAY FROM ZERO, at {@link POSED_SCORE}, and the check reads
// the score back against that number rather than against `0`. That is what makes a
// failure name the wrong model the build shipped: a build that pays a formation
// Shard reads `POSED_SCORE + SCORE_SHARD_FORM` (`50`), one that pays a diving
// Shard reads `POSED_SCORE + SCORE_SHARD_DIVE` (`100`), and one that clears the
// run's score on a wasted shot reads `0`. Against a starting score of `0` the
// third of those would pass silently.
//
// The posed score is an order of magnitude below `EXTRA_LIFE_AT` (`20000`,
// `specs/progression.md`), so the run's one extra life cannot be crossed and
// nothing but this shot can touch the score.
//
// THE SHOT HAS TO ARRIVE, or the reading is worthless: a score nothing was fired
// at is trivially unchanged. So the check reads that the bullet resolved at the
// drone or climbed past its centre, the same guard `bands/mismatch-spares` stands.

import { afterEach, beforeEach, it } from "vitest";
import {
  EXTRA_LIFE_AT,
  PLAYER_BULLET_HALF,
  PLAYER_BULLET_SPEED,
  SCORE_SHARD_DIVE,
  SCORE_SHARD_FORM,
  SHARD_HALF,
} from "../constants";
import { assertEqual, assertTrue } from "../assert";
import {
  LANE_CENTER,
  bulletById,
  captureStill,
  createHarness,
  fireAt,
  poseDrone,
  startPosed,
  type Harness,
} from "../harness";
import { requireDrone } from "./target";

/**
 * Where the target Shard stands: the posture `bands/mismatch-spares` fires into.
 *
 * Mid-field on the ship's own lane centre, clear of both HUD strips (`FIELD_TOP`
 * `64`, `FIELD_BOTTOM` `656`) and far above `SHIP_Y` (`600`).
 */
const TARGET_X = LANE_CENTER;
const TARGET_Y = 320;

/** The Shard's stored band, and the opposite one the shot carries. */
const DRONE_BAND = "cyan" as const;
const SHOT_BAND = "magenta" as const;

/**
 * How close two centres come for the circles to overlap, in logical units:
 * `SHARD_HALF` (`14`) + `PLAYER_BULLET_HALF` (`6`), by `specs/simulation.md`.
 */
const TOUCHING = SHARD_HALF + PLAYER_BULLET_HALF;

/** How far below the target the shot starts: seven times the contact reach. */
const SHOT_BELOW = 7 * TOUCHING;

/**
 * Frames the flight is allowed.
 *
 * At `PLAYER_BULLET_SPEED` (`760`, `specs/ship.md`), 7.6 units per frame of the
 * harness's 100 Hz clock: the bullet enters the contact reach inside 16 frames
 * and, consumed or not, is 88 units past the target's centre by frame 30.
 */
const FLIGHT_TICKS = 30;

/**
 * Seconds run after the shot has crossed, before the score is read.
 *
 * A tenth of a second, so a build that pays a frame or two after the contact is
 * caught rather than read too early. Nothing a conformant build does scores over
 * them: the field holds one inert drone and the wave's own gates are shut.
 */
const SETTLE_SECONDS = 0.1;

/**
 * The score the run carries when the shot is fired, in points.
 *
 * Any number would do; this one is no figure of `specs/scoring.md` and no multiple
 * of one, so every wrong payment reads as its own number and none lands back on
 * the posed value by coincidence. It is an order of magnitude below
 * `EXTRA_LIFE_AT` (`20000`), so the run's one extra life cannot be crossed by
 * anything this scenario does.
 */
const POSED_SCORE = 1234;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("pays nothing for a shot of the band opposite the drone's", async () => {
  startPosed(h);
  h.debug.setScore(POSED_SCORE);
  const droneId = poseDrone(h, "shard", TARGET_X, TARGET_Y, {
    band: DRONE_BAND,
  });

  const posed = h.snapshot();
  assertEqual(
    posed.score,
    POSED_SCORE,
    "precondition: the score the mismatched shot is measured from " +
      "(specs/instrumentation.md)",
  );
  assertEqual(
    requireDrone(posed, droneId, "the posed Shard, read for its band").band,
    DRONE_BAND,
    `precondition: the target's stored band, the opposite of the ${SHOT_BAND} ` +
      "shot's, so the shot to come is a mismatched one (specs/bands.md)",
  );

  const bulletId = await fireAt(
    h,
    TARGET_X,
    TARGET_Y,
    SHOT_BAND,
    SHOT_BELOW,
    FLIGHT_TICKS,
  );
  const arrived = bulletById(h.snapshot(), bulletId);
  await h.advanceSeconds(SETTLE_SECONDS);
  captureStill(h, "score");

  assertTrue(
    arrived === undefined || arrived.y < TARGET_Y,
    `precondition: the ${SHOT_BAND} shot reached the Shard — fired ` +
      `${SHOT_BELOW} units below y ${TARGET_Y} and flown ${FLIGHT_TICKS} ` +
      `frames, which at PLAYER_BULLET_SPEED ${PLAYER_BULLET_SPEED} leaves it ` +
      "either resolved on contact or climbed past the drone's centre " +
      "(specs/ship.md)",
  );

  assertEqual(
    h.snapshot().score,
    POSED_SCORE,
    `the score after a ${SHOT_BAND} bullet crossed a stored-${DRONE_BAND} ` +
      "Shard — unchanged, since a mismatched shot adds nothing to it " +
      "(specs/mode.md) and a shot that destroys no drone pays nothing " +
      `(specs/scoring.md), where a destroyed Shard would have paid ` +
      `SCORE_SHARD_FORM (${SCORE_SHARD_FORM}) or SCORE_SHARD_DIVE ` +
      `(${SCORE_SHARD_DIVE}); the run stands far below EXTRA_LIFE_AT ` +
      `(${EXTRA_LIFE_AT})`,
  );
});
