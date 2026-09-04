// flight/turn-rate-left — the counter-clockwise rotation runs at the stated rate.
//
// THE RULE. `specs/ship.md`: "While a turn key is held the facing rotates at a
// constant `SHIP_TURN` (`300` degrees per second): the left key turns
// counter-clockwise, the right key clockwise." `specs/controls.md` binds the left
// rotation to `ArrowLeft` and `KeyA` and reads it as a hold. So one second of the
// key down is 300 degrees of facing, and this item decides the LEFT direction
// alone — `flight/turn-rate-right` decides the other, so a build that turns at
// the right rate in one direction and the wrong rate in the other loses one point
// rather than two.
//
// WHICH WAY IS COUNTER-CLOCKWISE. `specs/overview.md` puts the origin at the top
// left with `y` increasing DOWNWARD and quotes angles clockwise from the positive
// `x` axis, so a counter-clockwise turn on screen DECREASES the facing angle: the
// second of held left is `-300` degrees. That sign is half of what this item is
// worth. A build that turns at exactly the right rate the wrong way reads `+300`
// and misses the bound by 600 degrees, which no tolerance can swallow.
//
// WHY THE SWEEP IS ACCUMULATED. 300 degrees is past the half turn a single angle
// difference can resolve, so the facing a build ends on cannot be subtracted from
// the one it started on: `-300` and `+60` are the same reading. `./turning.ts`
// explains the sampling that recovers the whole swept angle, and why the key goes
// down once rather than once per sample.
//
// WHY THREE PERCENT. Nine degrees, on 300. A conformant build's whole slack is
// which tick the key edge lands on — one tick is 2.5 degrees, 0.83 percent — so
// three percent leaves room for three of them and still fails every wrong rate:
// 180 degrees per second reads 180, a build turning by a fixed step per FRAME
// rather than per second of game time reads whatever its frame rate makes of it,
// and a build that does not turn at all reads 0.
//
// The pose is `startPlaying`'s and nothing more: an emptied, gated field with the
// ship at rest at the safe point. It never moves, so no wrap, no well and no core
// can reach the reading — a turn is the only thing happening on the field.

import { afterEach, beforeEach, it } from "vitest";
import { assertLessThanOrEqual } from "../assert";
import { KEYS_LEFT, SHIP_TURN, SHIP_TURN_DEG } from "../constants";
import {
  captureStill,
  createHarness,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import { accumulateTurn } from "./turning";

/** The second of held rotation the item names. */
const TURN_TICKS = ticksFor(1);

/**
 * How often the facing is sampled over that second: every eighth of a second, 37.5
 * degrees, comfortably inside the half turn a single reading can tell apart.
 */
const SAMPLE_TICKS = 15;

/** Counter-clockwise, so the facing angle falls by a whole `SHIP_TURN`. */
const EXPECTED_TURN = -SHIP_TURN;

/** Three percent of `SHIP_TURN`: nine degrees, in radians. */
const TURN_TOLERANCE = SHIP_TURN * 0.03;

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

it("sweeps SHIP_TURN counter-clockwise over a second of the left key", async () => {
  await startPlaying(harness);

  const swept = await accumulateTurn(
    harness,
    KEYS_LEFT[0],
    TURN_TICKS,
    SAMPLE_TICKS,
  );
  await captureStill(harness, "turn");

  assertLessThanOrEqual(
    Math.abs(swept - EXPECTED_TURN),
    TURN_TOLERANCE,
    `a second of the left key sweeps ${SHIP_TURN_DEG} degrees counter-clockwise, in radians`,
  );
});
