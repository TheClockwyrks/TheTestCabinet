// swarm/formation-holds-slot — a drone resting in the formation rides its slot.
//
// specs/swarm.md, "The formation": "A drone in phase `formation` sits at its slot
// plus the sway offset `specs/field.md` fixes, and it stays there until it is
// launched into a dive or destroyed." specs/field.md fixes both the offset and
// the clock it is read at: "A drone resting in a slot sits at
// `(slotX(col) + swayOffset(t), slotY(row))`", where "`t` is the wave's sway
// clock: the seconds the wave has been played, which returns to `0` when a wave
// is built and advances with game time while the live wave is running."
//
// HOW `t` IS KNOWN WITHOUT ASKING THE BUILD. The sway clock is not on the
// snapshot, and it does not need to be. `specs/instrumentation.md` has `reset`
// return the wave's sway clock to its fresh-wave value, the harness resets before
// a check touches anything, and this check drives NO frame before it opens the
// live wave. So every frame it then drives is a frame of live wave, and `t` is
// exactly the game time this check has driven — which is what makes the item's
// own reading, "a formation drone's centre equals its slot plus the sway offset,
// within one unit", decidable rather than a bound on how far the drone may stray.
//
// ONE DRONE, IN ONE SLOT, WITH TRAVEL ITS ONLY FACULTY, exactly as
// `field/sway-amplitude` poses it: `specs/instrumentation.md` makes travel the
// gate on "its ride on the formation sway", so oscillation and firing are off and
// nothing about the drone moves but the thing under test. `startPosed` shuts the
// wave's entry gate, so no other drone joins it, and its dive gate, so it is
// never launched out of the slot mid-sweep — which is the one thing the
// specification says ends the hold.
//
// The slot is off the grid's centre column, so a build that anchors the block
// rather than the drone is read against a slot the middle of the formation does
// not sit on. A WHOLE PERIOD is swept, which is the item's own figure, so the
// reading covers both extremes of the swing and everything between them.

import { afterEach, beforeEach, it } from "vitest";
import { assertLessThanOrEqual } from "../assert";
import { SWAY_PERIOD, slotX, slotY, swayOffset } from "../constants";
import {
  captureReplay,
  createHarness,
  framesFor,
  poseDrone,
  requireDrone,
  seconds,
  startPosed,
  type Harness,
} from "../harness";

/** How far the centre may sit from the slot plus the offset: the item's one unit. */
const HOLD_TOLERANCE = 1;

/** How often the drone is read during the sweep, in frames. */
const SAMPLE_EVERY = 5;

/** A whole SWAY_PERIOD of frames: the span the item reads over. */
const SWEEP_FRAMES = framesFor(SWAY_PERIOD);

/** The slot the drone rests in: off the grid's centre, in the middle rows. */
const SLOT = { col: 2, row: 2 } as const;

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

it("holds a formation drone at its slot plus the sway offset across a whole period", async () => {
  await startPosed(harness);
  const id = await poseDrone(
    harness,
    "shard",
    slotX(SLOT.col),
    slotY(SLOT.row),
    { phase: "formation", travel: true },
  );

  const readings: { t: number; x: number; y: number }[] = [];
  await captureReplay(harness, "holding", async () => {
    for (
      let frame = SAMPLE_EVERY;
      frame <= SWEEP_FRAMES;
      frame += SAMPLE_EVERY
    ) {
      await harness.advance(SAMPLE_EVERY);
      const drone = requireDrone(
        await harness.snapshot(),
        id,
        "the drone resting in its slot",
      );
      readings.push({ t: seconds(frame), x: drone.x, y: drone.y });
    }
  });

  for (const reading of readings) {
    const expected = slotX(SLOT.col) + swayOffset(reading.t);
    assertLessThanOrEqual(
      Math.abs(reading.x - expected),
      HOLD_TOLERANCE,
      `how far the drone's centre x sat from slotX(${SLOT.col}) + ` +
        `swayOffset(${reading.t.toFixed(2)}) (${expected.toFixed(2)}) ` +
        `${reading.t.toFixed(2)}s into the live wave (specs/swarm.md, ` +
        `specs/field.md)`,
    );
    assertLessThanOrEqual(
      Math.abs(reading.y - slotY(SLOT.row)),
      HOLD_TOLERANCE,
      `how far the drone's centre y sat from slotY(${SLOT.row}) ` +
        `(${slotY(SLOT.row)}) ${reading.t.toFixed(2)}s into the live wave, ` +
        `the sway being horizontal (specs/field.md)`,
    );
  }
});
