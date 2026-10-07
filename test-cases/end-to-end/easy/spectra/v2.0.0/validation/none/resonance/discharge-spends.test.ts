// resonance/discharge-spends — taken with the meter full, the discharge action
// leaves the meter at zero.
//
// THE RULE. `specs/resonance.md`'s first row: "At `RESONANCE_MAX` | Sets the
// meter to `0` and starts the wave below." This point reads the METER half of
// that row. The other half — that the key starts a wave at all — is
// `controls/discharge-x`, and what the wave then takes is the rest of this
// directory. That separation is deliberate: a build whose key is wired correctly
// and whose meter accounting is wrong must lose this point and keep that one.
//
// ZERO, NOT MERELY LOWER. "Sets the meter to `0`" is a write of the whole meter,
// so a build that deducts a fixed price, or that halves the meter, or that leaves
// a point behind reads a number this check names rather than passing on having
// gone down.
//
// THE ACTION IS A REAL KEY. `specs/instrumentation.md` gives the surface no
// operation that discharges — "A caller checking the discharge poses the meter
// and drives the discharge action" — so the whole path from the physical key to
// the spent meter is the build's own. The meter is posed with `setResonance`,
// which the same file gives for exactly this, rather than filled by absorbing
// seventeen bullets.
//
// THE FIELD IS EMPTY. `startPosed` clears the four rosters and shuts the wave's
// three gates, so the discharge destroys nothing, scores nothing and pops
// nothing: what is read back is the meter rather than any consequence of the
// wave.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertEqual } from "../assert";
import { RESONANCE_MAX } from "../constants";
import {
  captureStill,
  createHarness,
  startPosed,
  type Harness,
} from "../harness";
import { DISCHARGE_KEY } from "./wave";

/** The meter the action is taken at: the one reading it is available from. */
const POSED_METER = RESONANCE_MAX;

/**
 * Decimal places the spent meter is read to.
 *
 * `specs/resonance.md` writes the meter to `0`, a whole number, so the only
 * slack allowed is the round-off of a build that carries the meter as a fraction
 * of `RESONANCE_MAX` and reports it scaled.
 */
const METER_DIGITS = 6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("empties the meter when the discharge action is taken at RESONANCE_MAX", async () => {
  await startPosed(h);
  await h.debug.setResonance(POSED_METER);

  const armed = await h.snapshot();
  assertEqual(
    armed.screen,
    "inWave",
    "precondition: the screen the discharge action is read on " +
      "(specs/controls.md)",
  );
  assertCloseTo(
    armed.resonance,
    POSED_METER,
    METER_DIGITS,
    "precondition: the meter the action is taken at",
  );

  await h.tap(DISCHARGE_KEY);
  const spent = await h.snapshot();
  await captureStill(h, "spent");

  assertCloseTo(
    spent.resonance,
    0,
    METER_DIGITS,
    `the meter after the discharge action was taken at RESONANCE_MAX ` +
      `(${RESONANCE_MAX}): set to 0, the whole meter rather than a price ` +
      `deducted from it (specs/resonance.md)`,
  );
});
