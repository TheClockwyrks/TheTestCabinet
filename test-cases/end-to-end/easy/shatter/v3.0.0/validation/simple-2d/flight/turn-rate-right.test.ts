// flight/turn-rate-right — the clockwise rotation runs at the stated rate.
//
// THE RULE. `specs/ship.md`: "While a turn key is held the facing rotates at a
// constant `SHIP_TURN` (`300` degrees per second): the left key turns
// counter-clockwise, the right key clockwise." `specs/controls.md` binds the
// `right` action to `ArrowRight` and `KeyD` and reads rotation as a hold. So one
// second of the action held is 300 degrees of facing, and this item decides the
// RIGHT direction alone — `flight/turn-rate-left` decides the other, so a build
// that turns at the right rate one way and the wrong rate the other loses one
// point rather than two.
//
// WHICH WAY IS CLOCKWISE. `specs/overview.md` puts the origin at the top left
// with `y` increasing DOWNWARD and measures angles clockwise from the positive
// `x` axis, so a clockwise turn on screen INCREASES the facing angle: the second
// of held right is `+300` degrees. That sign is half of what this item is worth.
// A build that turns at exactly the right rate the wrong way reads `-300` and
// misses the bound by 600 degrees, which no tolerance can swallow — and a build
// that drove BOTH turn actions through one sign fails here while passing
// `flight/turn-rate-left`, which is what makes the pair worth two points rather
// than one graded twice.
//
// WHY THE SWEEP IS ACCUMULATED RATHER THAN SUBTRACTED. 300 degrees is past the
// half turn a single angle difference can resolve, so the facing a build ends on
// cannot simply be subtracted from the one it started on: `+300` and `-60` are
// the same reading. `./drive.ts` explains the sampling that recovers the whole
// swept angle, and why the key goes down once rather than once per sample.
//
// WHY THREE PERCENT. Nine degrees, on three hundred. A conformant build's whole
// slack here is which tick the key edge lands on — one tick at `SHIP_TURN` is 2.5
// degrees, 0.83 percent — so three percent leaves room for three of them and
// still fails every wrong rate: a build turning at 180 degrees per second reads
// 180, a build stepping a fixed angle per FRAME rather than per second of game
// time reads whatever its frame rate makes of it, and a build whose right key
// does nothing reads 0.
//
// THE POSE IS `startPlaying`'s AND NOTHING MORE: an emptied, gated field with the
// ship at rest at the safe point, 200 units clear of the star's centre. It never
// moves, so no wrap, no well and no core can reach the reading — the ship's own
// rotation is the only thing happening on the field. Thrust is never held, so the
// velocity stays at zero and the drag and the cap have nothing to act on.

import { afterEach, beforeEach, it } from "vitest";
import { SHIP_TURN } from "../constants";
import { assertLessThanOrEqual } from "../assert";
import { degrees } from "../geometry";
import {
  captureStill,
  createHarness,
  keyFor,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import { heldTurn } from "./drive";

/** The second of held rotation the item names. */
const TURN_TICKS = ticksFor(1);

/**
 * How often the facing is sampled over that second: every eighth of a second,
 * which is 37.5 degrees at `SHIP_TURN` — comfortably inside the half turn a
 * single short-way reading can tell apart. See `./drive.ts`.
 */
const SAMPLE_TICKS = 15;

/** Clockwise, so the facing angle rises by a whole `SHIP_TURN`. */
const EXPECTED_SWEEP = SHIP_TURN;

/** Three percent of `SHIP_TURN`: nine degrees, in radians. See the header. */
const SWEEP_TOLERANCE = SHIP_TURN * 0.03;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("sweeps SHIP_TURN clockwise over a second of the right action", async () => {
  startPlaying(h);

  const swept = await heldTurn(h, keyFor("right"), TURN_TICKS, SAMPLE_TICKS);
  captureStill(h, "turn");

  assertLessThanOrEqual(
    Math.abs(swept - EXPECTED_SWEEP),
    SWEEP_TOLERANCE,
    `how far the accumulated sweep of a second of ${keyFor("right")} sits from ` +
      `${degrees(SHIP_TURN).toFixed(0)} degrees clockwise, in radians ` +
      "— the right key turns clockwise at SHIP_TURN (specs/ship.md)",
  );
});
