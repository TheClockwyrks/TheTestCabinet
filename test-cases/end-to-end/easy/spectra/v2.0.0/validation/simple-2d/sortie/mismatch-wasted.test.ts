// sortie/mismatch-wasted — a mismatched shot leaves the drone exactly as it was.
//
// THE RULE. `specs/mode.md` (Sortie): "A shot whose effective band is the
// opposite of the drone's leaves that drone exactly as it was. Its phase, its
// position, its slot, its stored band, its band clock, its shell, and its course
// are all unchanged, and it is neither redirected nor marked in any way."
//
// This is the mode's whole difference from the other one, so it is the mode's own
// item. The two halves `specs/bands.md` owns are graded in common and are NOT read
// here: that the drone is not destroyed is `bands/mismatch-spares`, and that the
// bullet is consumed is `bands/mismatch-consumes-bullet`. What is left — and it is
// only this mode's — is that the drone is OTHERWISE untouched, which is what this
// check reads: the drone's whole record before the shot against the same record
// after it.
//
// THE TARGET IS A SHARD, and that is the sharp choice. The other mode's Shard
// reaction is to enter phase `diving` in the frame the drone overloads, so a build
// that shipped Overload's rule under Sortie's name reads back a different `phase`
// and this check names it. A build that flips the drone's band, breaks a layer,
// nudges it off its slot or lights any of its three faculties reads back a
// different field of the same record, and the failure pair prints which one.
//
// THE POSTURE IS `bands/mismatch-spares`'s, FIGURE FOR FIGURE — the same
// {@link TARGET_X}, {@link TARGET_Y}, the same stored-cyan Shard, the same magenta
// shot fired from the harness's own `SHOT_GAP` below it — so the two points differ
// only in what they read off the result, and the claim this file makes about the
// scenario ("nothing was destroyed") is the claim that file grades.
//
// THE SHOT HAS TO ARRIVE, or the reading is worthless: a drone nothing reached is
// trivially unchanged. So the check first reads that the bullet resolved at the
// drone or climbed past it, which is `PLAYER_BULLET_SPEED` doing what
// `specs/ship.md` fixes. It is not a second requirement of this point — it is the
// shot this point is about being fired at all — and the same guard stands in
// `bands/mismatch-spares`. Whether the bullet STOPS at the drone is
// `bands/mismatch-consumes-bullet`'s requirement, not this one, so a pass-through
// build is graded there and reads "unchanged" here, which is the correct verdict
// for THIS point.
//
// THE DRONE IS POSED AS A PROP: travel, oscillation and firing all off, which
// `specs/instrumentation.md` says holds its exact centre and its phase. So every
// difference the reading can show is one the shot made, not one the world made.
//
// No bystander is posed: this scenario destroys nothing, so no stage-clear reading
// is in play.

import { afterEach, beforeEach, it } from "vitest";
import { PLAYER_BULLET_SPEED } from "../constants";
import {
  assertCloseTo,
  assertDeepEqual,
  assertEqual,
  assertTrue,
} from "../assert";
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
  type DroneSnapshot,
  type Harness,
} from "../harness";

/**
 * Where the target Shard stands: the posture `bands/mismatch-spares` fires into.
 *
 * Mid-field on the ship's own lane centre, clear of both HUD strips (`FIELD_TOP`
 * `64`, `FIELD_BOTTOM` `656`) and far above `SHIP_Y` (`600`), so nothing but the
 * shot is anywhere near it.
 */
const TARGET_X = LANE_CENTER;
const TARGET_Y = 320;

/** The Shard's stored band, and the opposite one the shot carries. */
const DRONE_BAND = "cyan" as const;
const SHOT_BAND = "magenta" as const;

/**
 * Seconds run after the shot has crossed, before the reading is taken.
 *
 * The rule is about what the shot DID, not about when a build got round to doing
 * it, so the reading is taken far enough past the contact that an effect applied a
 * frame or two late is still caught. Nothing a conformant build does moves this
 * drone over a tenth of a second: its three faculties are off and the wave's own
 * gates are shut.
 */
const SETTLE_SECONDS = 0.1;

/**
 * Decimal places the four coordinates and the band clock are compared to, so
 * `0.0005` of a logical unit.
 *
 * `specs/instrumentation.md` gates locomotion with `setDroneTravel`, and a drone
 * whose travel is off holds its exact centre — so the specification allows no
 * movement at all here and the only slack wanted is float noise from a build that
 * recomputes a coordinate rather than storing it. It is four orders of magnitude
 * under the 20-unit contact reach, so no real redirection hides inside it.
 */
const HELD_DIGITS = 3;

/**
 * The fields of a drone's record a mismatched shot must leave alone that compare
 * exactly. The five that carry a coordinate or a clock are read beside them, to
 * {@link HELD_DIGITS}.
 */
function record(drone: DroneSnapshot) {
  return {
    kind: drone.kind,
    band: drone.band,
    effectiveBand: drone.effectiveBand,
    phase: drone.phase,
    shimmer: drone.shimmer,
    shellAlive: drone.shellAlive,
    travel: drone.travel,
    oscillation: drone.oscillation,
    fire: drone.fire,
  };
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves the drone a mismatched shot crossed exactly as it was", async () => {
  startPosed(h);
  const droneId = poseDrone(h, "shard", TARGET_X, TARGET_Y, {
    band: DRONE_BAND,
  });

  const before = droneOf(h.snapshot(), droneId);
  const beforeRecord = record(before);
  assertEqual(
    before.band,
    DRONE_BAND,
    `precondition: the target's stored band, the opposite of the ${SHOT_BAND} ` +
      "shot's, so the shot to come is a mismatched one (specs/bands.md)",
  );

  const bulletId = await fireAt(h, TARGET_X, TARGET_Y, SHOT_BAND, SHOT_GAP);
  const arrived = findBullet(h.snapshot(), bulletId);
  await h.advanceSeconds(SETTLE_SECONDS);
  captureStill(h, "unchanged");

  assertTrue(
    arrived === null || arrived.y < TARGET_Y,
    `precondition: the ${SHOT_BAND} shot reached the Shard — fired ${SHOT_GAP} ` +
      `units below y ${TARGET_Y} and flown the frames PLAYER_BULLET_SPEED ` +
      `${PLAYER_BULLET_SPEED} needs to cover them, it has either resolved on ` +
      "contact or climbed past the drone's centre (specs/ship.md)",
  );

  const after = droneOf(h.snapshot(), droneId);

  assertDeepEqual(
    record(after),
    beforeRecord,
    `the stored-${DRONE_BAND} Shard's kind, band, phase, shell and three ` +
      `faculties after a ${SHOT_BAND} bullet crossed it — all unchanged, since ` +
      "a mismatched shot leaves the drone exactly as it was (specs/mode.md)",
  );
  assertCloseTo(
    after.x,
    before.x,
    HELD_DIGITS,
    "the drone's x, unmoved by the mismatched shot (specs/mode.md)",
  );
  assertCloseTo(
    after.y,
    before.y,
    HELD_DIGITS,
    "the drone's y, unmoved by the mismatched shot (specs/mode.md)",
  );
  assertCloseTo(
    after.slotX,
    before.slotX,
    HELD_DIGITS,
    "the drone's slot x, unchanged by the mismatched shot (specs/mode.md)",
  );
  assertCloseTo(
    after.slotY,
    before.slotY,
    HELD_DIGITS,
    "the drone's slot y, unchanged by the mismatched shot (specs/mode.md)",
  );
  assertCloseTo(
    after.bandClock,
    before.bandClock,
    HELD_DIGITS,
    "the drone's band clock, unchanged by the mismatched shot (specs/mode.md)",
  );
});
