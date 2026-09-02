// torpedo/recharge-is-linear — the charge fills at a steady rate, not on a curve.
//
// THE RULE. `specs/weapons.md`, "The torpedo", The charge: "The charge then rises
// LINEARLY from `0` to `1` over `TORPEDO_RECHARGE` (`10` seconds) of game time,
// so it reads `0.5` at five seconds and `0.25` at two and a half." The two
// intermediate values are stated in the specification itself, which is what makes
// the SHAPE of the refill a rule rather than the build's choice: without that
// sentence an ease-in curve, an ease-out curve or a refill that steps in quarters
// would all be conformant, and all three would fail here.
//
// TWO READINGS, BECAUSE ONE DECIDES NOTHING. A single sample at five seconds is
// met by any monotone curve that happens to pass through `0.5` there. Taking
// `2.5` s as well pins the rate at both quarters of the span: an ease-in that
// reads `0.5` at halfway reads about `0.06` at a quarter, an ease-out reads about
// `0.44`, and a refill stepped in quarters reads `0.25` at one and `0.5` at the
// other but only by landing exactly on the step boundary — which the tolerance
// below is far too tight to forgive on a build whose steps are anywhere else.
//
// THAT THE BAR IS FULL AT TEN SECONDS IS A DIFFERENT ITEM. `recharges-in-ten-
// seconds` decides the figure; this one decides the shape, and reads nothing at
// the end of the span. A build that fills linearly over twenty seconds fails
// both, and a build that fills over ten on a curve fails only this one.
//
// THE CHARGE IS POSED EMPTY, for the reasons `recharges-in-ten-seconds` sets out:
// the rule is about a charge below `1` rather than about the launch that put it
// there, and posing it leaves no torpedo in flight across the five seconds this
// check advances.

import { afterEach, beforeEach, it } from "vitest";
import { TORPEDO_RECHARGE } from "../constants";
import { assertLessThanOrEqual } from "../assert";
import {
  captureStill,
  createHarness,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import { POSED_CHARGE_SLACK, requireCharge } from "./scenario";

/** The two moments the specification states a value for, in seconds of game time. */
const QUARTER_AT = TORPEDO_RECHARGE / 4;
const HALF_AT = TORPEDO_RECHARGE / 2;

/** What a linear rise from 0 to 1 over TORPEDO_RECHARGE reads at each of them. */
const QUARTER_CHARGE = QUARTER_AT / TORPEDO_RECHARGE;
const HALF_CHARGE = HALF_AT / TORPEDO_RECHARGE;

/**
 * How far either reading may fall from the value the specification states, as a
 * fraction of the bar.
 *
 * `0.03`, the figure the review item states, which is thirty-six ticks of the
 * refill. It is a reading allowance and not room on the shape: the nearest wrong
 * shape a build might implement — a quadratic ease-in — reads `0.0625` at the
 * quarter mark, `0.19` away, six times this bound.
 */
const CHARGE_TOLERANCE = 0.03;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reads a quarter of the charge at 2.5 s and half of it at 5 s", async () => {
  startPlaying(h);
  h.debug.setTorpedoCharge?.(0);

  assertLessThanOrEqual(
    requireCharge(h.snapshot(), "the charge the refill starts from"),
    POSED_CHARGE_SLACK,
    "setTorpedoCharge(0) to leave the charge empty, so both readings are " +
      "taken along one whole refill (specs/instrumentation.md)",
  );

  await h.advance(ticksFor(QUARTER_AT));
  const quarter = requireCharge(h.snapshot(), `the charge at ${QUARTER_AT} s`);

  await h.advance(ticksFor(HALF_AT) - ticksFor(QUARTER_AT));
  const half = requireCharge(h.snapshot(), `the charge at ${HALF_AT} s`);
  // The charge half full, five seconds into the refill.
  captureStill(h, "halfway");

  assertLessThanOrEqual(
    Math.abs(quarter - QUARTER_CHARGE),
    CHARGE_TOLERANCE,
    `torpedoCharge to read ${QUARTER_CHARGE} at ${QUARTER_AT} s of the ` +
      `refill, within ${CHARGE_TOLERANCE} — the charge rises linearly from 0 ` +
      `to 1 over TORPEDO_RECHARGE (${TORPEDO_RECHARGE} s), so a quarter of the ` +
      `span is a quarter of the bar (specs/weapons.md); read ` +
      `${quarter.toFixed(4)}`,
  );
  assertLessThanOrEqual(
    Math.abs(half - HALF_CHARGE),
    CHARGE_TOLERANCE,
    `torpedoCharge to read ${HALF_CHARGE} at ${HALF_AT} s of the refill, ` +
      `within ${CHARGE_TOLERANCE} — the charge rises linearly over ` +
      `TORPEDO_RECHARGE (${TORPEDO_RECHARGE} s) (specs/weapons.md); read ` +
      `${half.toFixed(4)}`,
  );
});
