// sortie/mismatch-wasted — a mismatched shot leaves the drone exactly as it was.
//
// specs/mode.md (Sortie): "A shot whose effective band is the opposite of the
// drone's leaves that drone exactly as it was. Its phase, its position, its slot,
// its stored band, its band clock, its shell, and its course are all unchanged,
// and it is neither redirected nor marked in any way."
//
// This is the mode's whole difference from the other one, so it is the mode's own
// item. The two halves specs/bands.md owns are graded in common and are NOT read
// here: that the drone is not destroyed is `bands/mismatch-spares`, and that the
// bullet is consumed is `bands/mismatch-consumes-bullet`. What is left — and it is
// only this mode's — is that the drone is otherwise untouched, which is what this
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
// WHY CONTACT IS NOT ASSERTED. The bullet is placed directly below the drone's
// centre and driven far enough to climb clear past it (see SHOT_FRAMES), so the
// crossing is geometry rather than something the build could decline. Whether the
// bullet stops there is `bands/mismatch-consumes-bullet`'s requirement, not this
// one, so a pass-through build is graded there and reads "unchanged" here — which
// is the correct verdict for THIS point.
//
// The drone is posed as a prop: travel, oscillation and firing all off, which
// specs/instrumentation.md says holds its exact centre and its phase. So every
// difference the reading can show is one the shot made, not one the world made.
//
// No bystander is posed: this scenario destroys nothing, so no stage-clear reading
// is in play.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertDeepEqual } from "../assert";
import { FORM_CENTER_X } from "../constants";
import {
  captureStill,
  createHarness,
  poseDrone,
  requireDrone,
  shootDrone,
  startPosed,
  type DroneView,
  type Harness,
} from "../harness";

/** Where the target Shard stands. As in `bands/mismatch-spares`. */
const TARGET = { x: FORM_CENTER_X, y: 300 } as const;

/**
 * How far below the target the shot is placed, in logical units.
 *
 * Seven times the 20-unit contact reach a Shard has against one of the player's
 * bullets (`SHARD_HALF` 14 + `PLAYER_BULLET_HALF` 6), so the bullet starts well
 * clear and climbs into the drone.
 */
const SHOT_BELOW = 140;

/**
 * Frames the flight is allowed.
 *
 * At `PLAYER_BULLET_SPEED` (760), 7.6 units per frame of the harness's 100 Hz
 * clock: the bullet reaches the drone inside 16 frames and, consumed or not, is
 * 88 units past its centre by frame 30 — so the crossing has certainly happened
 * however the build resolves it.
 */
const SHOT_FRAMES = 30;

/**
 * Frames run after the shot has resolved, before the reading is taken.
 *
 * A tenth of a second. The rule is about what the shot did, not about when a
 * build got round to doing it, so the reading is taken far enough past the
 * contact that an effect applied a frame or two late is still caught. Nothing a
 * conformant build does moves this drone over them: its three faculties are off
 * and the wave's own gates are shut.
 */
const SETTLE_FRAMES = 10;

/**
 * Decimal places the four coordinates and the band clock are compared to, so
 * `0.0005` of a logical unit.
 *
 * specs/instrumentation.md: a drone whose travel is off "holds its exact center
 * and keeps its phase", so the specification allows no movement at all here and
 * the only slack wanted is float noise from a build that recomputes a coordinate
 * rather than storing it. It is four orders of magnitude under the 20-unit
 * contact reach, so no real redirection hides inside it.
 */
const HELD_DIGITS = 3;

/** Every field of a drone's record that a mismatched shot must leave alone. */
function record(drone: DroneView) {
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

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

it("leaves the drone a mismatched shot crossed exactly as it was", async () => {
  await startPosed(harness);
  const target = await poseDrone(harness, "shard", TARGET.x, TARGET.y, {
    band: "cyan",
  });
  const before = requireDrone(
    await harness.snapshot(),
    target,
    "the posed Shard, before the mismatched shot",
  );

  await shootDrone(harness, target, "magenta", {
    below: SHOT_BELOW,
    maxFrames: SHOT_FRAMES,
  });
  await harness.advance(SETTLE_FRAMES);
  await captureStill(harness, "unchanged");

  const after = requireDrone(
    await harness.snapshot(),
    target,
    "the stored-cyan Shard a magenta shot leaves alive and exactly as it was (specs/mode.md)",
  );

  assertDeepEqual(
    record(after),
    record(before),
    "the drone's phase, band, shell and course, unchanged by the mismatched shot (specs/mode.md)",
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
