// resonance/discharge-locked — taken one point short of full, the discharge
// action spends nothing and starts no wave.
//
// THE RULE. `specs/resonance.md`'s second row: "Below `RESONANCE_MAX` | Does
// nothing: the meter is unchanged and no wave starts." It is the opposite
// direction of `resonance/discharge-spends`, so a build that discharges on every
// press and a build that never discharges grade differently rather than averaging
// out.
//
// THE POSE IS ONE POINT SHORT, the closest a build's threshold can be to the
// ceiling and still be wrong, so a build whose gate reads `resonance > 0`, or
// `resonance >= RESONANCE_MAX - 1`, or anything but the stated equality fails
// here.
//
// THREE READINGS, ONE ROW. "Does nothing" is asserted as the meter still standing
// where it was posed, as no wave reported live, and as a drone the wave would
// have taken still standing at the end of the span a wave would have run. The
// third is what closes the gap the first two leave: a build that runs a wave
// without reporting `discharge.active`, or whose wave has already ended by the
// time the field is read, still has to leave the diver alive.
//
// THE DIVER IS THE ONE THING ON THE FIELD BESIDES THE SHIP. It is posed in phase
// `diving`, which `specs/resonance.md` puts squarely among what a wave destroys,
// with every faculty off so it holds its place and fires nothing — so if it is
// gone at the end, the only thing that can have taken it is a wave that should
// never have started. Nothing is destroyed here, so no stage can clear underneath
// the reading and no bystander is needed.
//
// WHAT THIS DOES NOT DECIDE. That a discharge at full spends the meter is
// `resonance/discharge-spends`; that `dischargeReady` reports the boundary is
// `resonance/ready-at-full`.

import { afterEach, beforeEach, it } from "vitest";
import { DISCHARGE_TIME, RESONANCE_MAX } from "../constants";
import { assertCloseTo, assertEqual, assertNotNull } from "../assert";
import {
  captureStill,
  createHarness,
  findDrone,
  poseDrone,
  startPosed,
  ticksFor,
  type Harness,
} from "../harness";
import { release } from "./wave";

/**
 * The meter the action is taken at, in meter points: one point short of full.
 *
 * The review item's own figure, and the smallest step `specs/resonance.md`'s
 * whole-number figures allow below the one reading a discharge is available at.
 */
const POSED_METER = RESONANCE_MAX - 1;

/**
 * Where the diver stands.
 *
 * Mid-field on the ship's own lane, clear of both HUD strips (`FIELD_TOP` `64`,
 * `FIELD_BOTTOM` `656`) and clear of `SHIP_Y` (`600`). It is `300` units from the
 * ship's centre, well inside `DISCHARGE_MAX_R` (`1500`), so a wave that did start
 * would reach it inside a fifth of its life.
 */
const DIVER_AT = { x: 640, y: 300 } as const;

/**
 * Frames run after the press: the whole span a wave would have been live for.
 *
 * `DISCHARGE_TIME` (`0.5` s) at the suite's clock, so a wave that started on the
 * press frame has expanded to `DISCHARGE_MAX_R` and stopped by the time the field
 * is read, and a diver `300` units out has had every one of those frames to be
 * taken.
 */
const WAVE_TICKS = ticksFor(DISCHARGE_TIME);

/** Decimal places the meter is read to: whole-number figures, round-off only. */
const METER_DIGITS = 6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("spends nothing and starts no wave one point short of RESONANCE_MAX", async () => {
  startPosed(h);
  const diver = poseDrone(h, "shard", DIVER_AT.x, DIVER_AT.y, {
    phase: "diving",
  });

  const armed = h.snapshot();
  assertEqual(
    armed.screen,
    "inWave",
    "precondition: the screen the discharge action is read on " +
      "(specs/controls.md)",
  );
  assertEqual(
    armed.discharge.active,
    false,
    "precondition: no wave is running before the press",
  );

  await release(h, POSED_METER);
  const pressed = h.snapshot();

  await h.advance(WAVE_TICKS);
  captureStill(h, "locked");
  const after = h.snapshot();

  assertCloseTo(
    pressed.resonance,
    POSED_METER,
    METER_DIGITS,
    `the meter after the discharge action was taken at ${POSED_METER}, one ` +
      `point below RESONANCE_MAX (${RESONANCE_MAX}): unchanged, since the ` +
      `action does nothing below the ceiling (specs/resonance.md)`,
  );
  assertEqual(
    pressed.discharge.active,
    false,
    `discharge.active after the action was taken at ${POSED_METER}: no wave ` +
      `starts below RESONANCE_MAX (${RESONANCE_MAX}) (specs/resonance.md)`,
  );
  assertNotNull(
    findDrone(after, diver),
    `the diving drone ${DISCHARGE_TIME} seconds after the action was taken at ` +
      `${POSED_METER}: still on the field, since no wave started to take it ` +
      `(specs/resonance.md)`,
  );
});
