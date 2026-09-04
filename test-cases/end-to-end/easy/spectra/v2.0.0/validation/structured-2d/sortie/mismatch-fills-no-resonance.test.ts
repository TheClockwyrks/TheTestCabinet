// sortie/mismatch-fills-no-resonance — a mismatched shot adds nothing to the meter.
//
// THE RULE. `specs/mode.md` (Sortie), of the wasted shot: it "adds nothing to the
// score and nothing to the resonance meter". `specs/resonance.md` agrees from the
// other side — it names exactly two events that fill the meter, an absorbed
// same-band enemy bullet (`RESONANCE_ABSORB` `6`) and a matching kill
// (`RESONANCE_KILL` `4`), and closes with "Nothing else moves the meter."
//
// THE METER IS POSED AWAY FROM ZERO AND AWAY FROM ITS CEILING, at
// {@link POSED_METER}. Both matter. Away from zero, a build that fills on a
// mismatch reads a number that names which figure it paid — `POSED_METER +
// RESONANCE_KILL` for a build that treats a wasted shot as a kill, `POSED_METER +
// RESONANCE_ABSORB` for one that treats it as an absorb, and `0` for one that
// empties the meter, which against a posed `0` would have passed silently. Away
// from `RESONANCE_MAX` (`100`), a wrong fill has room to show: posed at the
// ceiling the cap `specs/resonance.md` fixes would swallow it and this check would
// pass a build that fills.
//
// The posed reading is also not a discharge — `specs/resonance.md` makes one
// available at exactly `RESONANCE_MAX` and not one point below — so nothing in the
// scenario can spend the meter either, and no wave is ever live to destroy the
// drone from underneath the reading.
//
// THE POSTURE IS `bands/mismatch-spares`'s, FIGURE FOR FIGURE — the same
// {@link TARGET_X}, {@link TARGET_Y}, the same stored-cyan Shard, the same magenta
// shot fired {@link SHOT_BELOW} units under it and flown {@link FLIGHT_TICKS}
// frames — so nothing is destroyed and no matching kill is anywhere in the
// scenario. The ship is never fired at, so no absorb is either. What the shot does
// to the DRONE is the sibling `sortie/mismatch-wasted`; what it does to the SCORE
// is `sortie/mismatch-scores-nothing`. This check reads the meter alone.
//
// THE WHOLE DRIVE IS 0.4 s, which is why the posed reading is compared exactly:
// that the meter does not decay with time is `resonance`'s own item, not this
// one's, and no build could decay perceptibly over four tenths of a second anyway.
//
// THE SHOT HAS TO ARRIVE, or the reading is worthless: a meter nothing was fired
// at is trivially unchanged. So the check reads that the bullet resolved at the
// drone or climbed past its centre, the same guard `bands/mismatch-spares` stands.

import { afterEach, beforeEach, it } from "vitest";
import {
  PLAYER_BULLET_HALF,
  PLAYER_BULLET_SPEED,
  RESONANCE_ABSORB,
  RESONANCE_KILL,
  RESONANCE_MAX,
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
 * Seconds run after the shot has crossed, before the meter is read.
 *
 * A tenth of a second, so a build that fills the meter a frame or two after the
 * contact is caught rather than read too early. Nothing a conformant build does
 * fills it over them: nothing is destroyed and nothing reaches the ship.
 */
const SETTLE_SECONDS = 0.1;

/**
 * The meter's reading when the shot is fired.
 *
 * `RESONANCE_MAX / 2` (`50`): high enough that a build which empties the meter
 * reads a different number, and low enough that either fill `specs/resonance.md`
 * knows — `RESONANCE_ABSORB` (`6`) and `RESONANCE_KILL` (`4`) — would land well
 * short of the `RESONANCE_MAX` ceiling and so be visible rather than clipped. It
 * is below `RESONANCE_MAX`, so no discharge is available to be spent either.
 */
const POSED_METER = RESONANCE_MAX / 2;

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
  assertEqual(
    posed.resonance,
    POSED_METER,
    "precondition: the meter the mismatched shot is measured from " +
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
  captureStill(h, "meter");

  assertTrue(
    arrived === undefined || arrived.y < TARGET_Y,
    `precondition: the ${SHOT_BAND} shot reached the Shard — fired ` +
      `${SHOT_BELOW} units below y ${TARGET_Y} and flown ${FLIGHT_TICKS} ` +
      `frames, which at PLAYER_BULLET_SPEED ${PLAYER_BULLET_SPEED} leaves it ` +
      "either resolved on contact or climbed past the drone's centre " +
      "(specs/ship.md)",
  );

  assertEqual(
    h.snapshot().resonance,
    POSED_METER,
    `the resonance meter after a ${SHOT_BAND} bullet crossed a ` +
      `stored-${DRONE_BAND} Shard — unchanged, since a mismatched shot adds ` +
      "nothing to it (specs/mode.md) and only an absorb " +
      `(RESONANCE_ABSORB ${RESONANCE_ABSORB}) or a matching kill ` +
      `(RESONANCE_KILL ${RESONANCE_KILL}) moves it (specs/resonance.md), ` +
      `neither of which this scenario holds; the ceiling RESONANCE_MAX ` +
      `(${RESONANCE_MAX}) is far off, so a wrong fill would have shown`,
  );
});
