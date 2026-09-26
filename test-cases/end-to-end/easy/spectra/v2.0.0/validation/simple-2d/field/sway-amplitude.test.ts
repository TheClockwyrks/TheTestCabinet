// field/sway-amplitude — the formation swings the full `SWAY_AMP` either side of
// its slot.
//
// specs/field.md, "The sway": "The block's offset is
// `swayOffset(t) = SWAY_AMP * sin(2 * PI * t / SWAY_PERIOD)`, with `SWAY_AMP`
// (`20`) and `SWAY_PERIOD` (`5`) seconds. A drone resting in a slot sits at
// `(slotX(col) + swayOffset(t), slotY(row))`". A sine of that amplitude reaches
// `+SWAY_AMP` and `-SWAY_AMP` once each in every period, so over one whole period a
// drone resting in its slot has to have been seen `SWAY_AMP` to the right of it and
// `SWAY_AMP` to the left of it, whatever phase the wave's sway clock happened to be
// at when the sweep opened.
//
// ONE DRONE, IN ONE SLOT, WITH ONE FACULTY. specs/instrumentation.md makes travel
// the gate on "its ride on the formation sway", so travel is on and oscillation and
// fire are off: nothing about the drone moves but the thing under test.
// `startPosed` shuts the wave's entry and dive gates, so no other drone joins it and
// it is never pulled into a dive mid-sweep. The slot is the grid's leftmost column,
// so the swing is read against a slot the whole grid does not sit on.
//
// The extremes are read against the SLOT rather than against each other, so a build
// that swings the right distance around the wrong centre fails, and a build that
// swings half as far fails on both readings rather than averaging out. WHEN the two
// extremes fall is `field/sway-period`; that they are the same for every drone is
// `field/sway-together`.

import { afterEach, beforeEach, it } from "vitest";
import { SWAY_AMP, SWAY_PERIOD, slotX, slotY } from "../constants";
import { assertLessThanOrEqual } from "../assert";
import {
  captureReplay,
  createHarness,
  droneOf,
  poseDrone,
  startPosed,
  ticksFor,
  type Harness,
} from "../harness";

/**
 * How far each extreme may sit from the amplitude the specification fixes, in
 * logical units. The item's own figure: within 10% of `SWAY_AMP` (20), so 2.
 */
const AMP_TOLERANCE = SWAY_AMP * 0.1;

/**
 * How often the drone's `x` is read during the sweep, in frames.
 *
 * Not a tolerance: the swing is a sine of period `SWAY_PERIOD` (5 s), and over the
 * 0.05 s this leaves between two samples it falls at most
 * `SWAY_AMP * (1 - cos(2 * PI * 0.025 / 5))` — about a thousandth of a unit — below
 * its peak. The sampled extreme is therefore the real one to far inside the
 * tolerance above.
 */
const SAMPLE_EVERY = ticksFor(0.05);

/**
 * The frames the sweep runs: one whole `SWAY_PERIOD`, plus one sample's worth so
 * the closing sample lands on or past the end of it.
 *
 * A full period from ANY phase visits both extremes, so nothing here depends on
 * where the wave's own sway clock stood when the drone was posed.
 */
const SWEEP_FRAMES = ticksFor(SWAY_PERIOD) + SAMPLE_EVERY;

/** The slot the drone rests in: the grid's leftmost column, middle row. */
const SLOT = { col: 0, row: 2 } as const;

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(() => {
  harness?.dispose();
});

it("carries a formation drone SWAY_AMP either side of its slot across a period", async () => {
  startPosed(harness);
  const id = poseDrone(harness, "shard", slotX(SLOT.col), slotY(SLOT.row), {
    phase: "formation",
    travel: true,
  });

  const seen = await captureReplay(harness, "swing", async () => {
    const xs: number[] = [];
    for (let frame = 0; frame < SWEEP_FRAMES; frame += SAMPLE_EVERY) {
      await harness.advance(SAMPLE_EVERY);
      xs.push(droneOf(harness.snapshot(), id).x);
    }
    return xs;
  });

  const rest = slotX(SLOT.col);
  assertLessThanOrEqual(
    Math.abs(Math.max(...seen) - (rest + SWAY_AMP)),
    AMP_TOLERANCE,
    `how far the drone's furthest RIGHT reading sat from slotX(` +
      `${String(SLOT.col)}) + SWAY_AMP (${String(rest + SWAY_AMP)}) across a ` +
      `whole SWAY_PERIOD (specs/field.md)`,
  );
  assertLessThanOrEqual(
    Math.abs(Math.min(...seen) - (rest - SWAY_AMP)),
    AMP_TOLERANCE,
    `how far the drone's furthest LEFT reading sat from slotX(` +
      `${String(SLOT.col)}) - SWAY_AMP (${String(rest - SWAY_AMP)}) across a ` +
      `whole SWAY_PERIOD (specs/field.md)`,
  );
});
