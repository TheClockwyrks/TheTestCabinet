// sortie/mismatch-fills-no-resonance — a mismatched shot adds nothing to the meter.
//
// THE RULE. `specs/mode.md` (Sortie), of the wasted shot: it "adds nothing to the
// score and nothing to the resonance meter". `specs/resonance.md` agrees from the
// other side — it names exactly two events that fill the meter, the hull absorbing
// an enemy bullet of the ship's own band (`RESONANCE_ABSORB` `6`) and one of the
// player's bullets destroying a drone by matching its band (`RESONANCE_KILL` `4`),
// and closes with "Nothing else moves the meter."
//
// THE METER IS POSED AWAY FROM ZERO AND AWAY FROM ITS CEILING, at
// {@link POSED_METER}. Both matter. Away from zero, a build that fills on a
// mismatch reads a number that names which figure it paid — `POSED_METER +
// RESONANCE_KILL` for a build that treats a wasted shot as a kill, `POSED_METER +
// RESONANCE_ABSORB` for one that treats it as an absorb, and `0` for one that
// empties the meter. Away from `RESONANCE_MAX` (`100`), a wrong fill has room to
// show: posed at the ceiling the cap would swallow it and the check would pass a
// build that fills. It is also not a discharge, which needs exactly
// `RESONANCE_MAX`, so nothing in the scenario can spend it either.
//
// THE POSTURE IS `bands/mismatch-spares`'s, FIGURE FOR FIGURE — the same
// {@link TARGET_X}, {@link TARGET_Y}, the same stored-cyan Shard, the same magenta
// shot fired from the harness's own `SHOT_GAP` below it — so nothing is destroyed
// and no matching kill is anywhere in the scenario. The ship is never touched and
// no enemy bullet is ever on the field, so no absorb is either. What the shot does
// to the DRONE is the sibling `sortie/mismatch-wasted`; what it does to the SCORE
// is `sortie/mismatch-scores-nothing`. This check reads the meter alone.
//
// THE SHOT HAS TO ARRIVE, or the reading is worthless: a meter nothing was fired
// at is trivially unchanged. So the check first reads that the bullet resolved at
// the drone or climbed past it, the same guard `bands/mismatch-spares` stands.
//
// THE WHOLE DRIVE IS UNDER THREE TENTHS OF A SECOND, which is why the posed
// reading is safe to compare against: that the meter does not decay with time is
// `resonance/no-decay`'s own item, and no build could decay perceptibly over that.

import { afterEach, beforeEach, it } from "vitest";
import {
  PLAYER_BULLET_SPEED,
  RESONANCE_ABSORB,
  RESONANCE_KILL,
  RESONANCE_MAX,
} from "../constants";
import { assertCloseTo, assertEqual, assertTrue } from "../assert";
import {
  LANE_CENTER,
  SHOT_GAP,
  captureStill,
  createHarness,
  droneOf,
  fireAt,
  findBullet,
  poseDrone,
  startPosed,
  type Harness,
} from "../harness";

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
 * Seconds run after the shot has crossed, before the meter is read.
 *
 * A tenth of a second, so a build that fills a frame or two after the contact is
 * caught rather than read too early. Nothing a conformant build does fills the
 * meter over them: nothing is destroyed and nothing reaches the ship.
 */
const SETTLE_SECONDS = 0.1;

/**
 * The meter's reading when the shot is fired, in meter points.
 *
 * Half of `RESONANCE_MAX` (`100`): clear of `0`, so a build that empties the meter
 * reads a different number, and far enough below the ceiling that either fill
 * `specs/resonance.md` knows would land well short of it and so be visible rather
 * than clipped.
 */
const POSED_METER = RESONANCE_MAX / 2;

/**
 * Decimal places the meter is read to, so `0.0000005` of a point.
 *
 * `specs/resonance.md` states the meter's two fills as whole numbers, so the
 * specification allows no change at all here and the only slack wanted is float
 * round-off from a build that carries the meter as a fraction of its ceiling. It
 * is six orders of magnitude under the smaller of the two fills,
 * `RESONANCE_KILL` (`4`), so no real fill hides inside it.
 */
const METER_DIGITS = 6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("fills nothing for a shot of the band opposite the drone's", async () => {
  startPosed(h);
  h.debug.setResonance(POSED_METER);
  const droneId = poseDrone(h, "shard", TARGET_X, TARGET_Y, {
    band: DRONE_BAND,
  });

  const posed = h.snapshot();
  assertCloseTo(
    posed.resonance,
    POSED_METER,
    METER_DIGITS,
    "precondition: the meter the mismatched shot is measured from",
  );
  assertEqual(
    droneOf(posed, droneId).band,
    DRONE_BAND,
    `precondition: the target's stored band, the opposite of the ${SHOT_BAND} ` +
      "shot's, so the shot to come is a mismatched one (specs/bands.md)",
  );

  const bulletId = await fireAt(h, TARGET_X, TARGET_Y, SHOT_BAND, SHOT_GAP);
  const arrived = findBullet(h.snapshot(), bulletId);
  await h.advanceSeconds(SETTLE_SECONDS);
  captureStill(h, "meter");

  assertTrue(
    arrived === null || arrived.y < TARGET_Y,
    `precondition: the ${SHOT_BAND} shot reached the Shard — fired ${SHOT_GAP} ` +
      `units below y ${TARGET_Y} and flown the frames PLAYER_BULLET_SPEED ` +
      `${PLAYER_BULLET_SPEED} needs to cover them, it has either resolved on ` +
      "contact or climbed past the drone's centre (specs/ship.md)",
  );

  assertCloseTo(
    h.snapshot().resonance,
    POSED_METER,
    METER_DIGITS,
    `the meter after a ${SHOT_BAND} bullet crossed a stored-${DRONE_BAND} ` +
      "Shard — unchanged, since a mismatched shot adds nothing to it " +
      `(specs/mode.md) and only an absorb (RESONANCE_ABSORB ` +
      `${RESONANCE_ABSORB}) or a matching kill (RESONANCE_KILL ` +
      `${RESONANCE_KILL}) fills it, out of RESONANCE_MAX (${RESONANCE_MAX}) ` +
      "(specs/resonance.md)",
  );
});
