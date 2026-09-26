// Wireworm — instrumentation/foe-travel-gate: a foe whose travel is gated off
// reports the same center after a second of game time as it did at the call.
//
// specs/instrumentation.md gives the operation exactly one faculty:
// `setFoeTravel(id, enabled)` "Gates the foe's locomotion alone: its position
// holds and its behavior runs on."
//
// IT IS WHAT LETS A SCENARIO PUT A FOE SOMEWHERE AND KEEP IT THERE. A bolt aimed
// at a foe, a foe posed just outside the cursor's box, a foe standing on one
// tile so the tile it acts on is not in question — every one of those needs the
// foe to be where it was put when the frame that matters runs. Every foe in this
// game moves under its own power the moment it exists (specs/foes.md gives each
// kind a resting velocity, and `addFoe` starts it at that velocity), so without
// this gate there is no such thing as a posed foe.
//
// THE WITNESS IS A GLITCH BECAUSE IT IS THE FOE THAT MOVES ON BOTH AXES.
// specs/foes.md travels it horizontally at `GLITCH_H_SPEED` (`210` units per
// second) and downward at `GLITCH_V_SPEED` (`62`) "both at once", so a build
// that gated one axis and not the other is caught here; a dropper or a corruptor
// would only ever witness one.
//
// ITS MIND IS HELD OFF TOO, WHICH IS THE ISOLATION THE GUIDANCE ASKS FOR. The
// requirement this point decides is the locomotion, so the foe is posed with
// only that faculty in play. The board is empty in any case — nothing is laid
// for a mind to act on — so whether a build's eating runs is neither exercised
// nor read here; `foes/glitch-eats-inert` decides it.
//
// A SECOND IS A LONG TIME TO HOLD STILL. At its resting velocity the glitch
// would cross six and a half tiles horizontally and two rows down inside the
// span, so a build whose gate merely slows the foe rather than stopping it is
// nowhere near the tolerance below, which is float noise and nothing else.

import { afterEach, beforeEach, it } from "vitest";
import { GLITCH_H_SPEED, GLITCH_V_SPEED } from "../constants";
import { assertCloseTo, assertDefined } from "../assert";
import {
  captureStill,
  createHarness,
  foeById,
  poseFoe,
  startPlaying,
  type Harness,
} from "../harness";

/** The tile the glitch is posed on, in the clear middle of an empty board. */
const GLITCH_C = 20;
const GLITCH_R = 10;

/** How long the board is driven for while the gate is held off, in seconds. */
const DRIVE_SECONDS = 1;

/**
 * How far the held foe's center may sit from where it was posed, in decimal
 * digits for `assertCloseTo` — six, which is half a millionth of a logical unit.
 *
 * A hold is a hold: the specification says the position holds, so this is the
 * float noise of reading a number back and not an allowance for drift. A build
 * that integrated even a hundredth of `GLITCH_H_SPEED` against the second below
 * misses it by two units.
 */
const HOLD_DIGITS = 6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("holds a gated foe at the center it was posed at", async () => {
  startPlaying(h);

  const id = poseFoe(h, "glitch", GLITCH_C, GLITCH_R);
  h.debug.setFoeTravel(id, false);
  h.debug.setFoeMind(id, false);

  const posed = foeById(h.snapshot(), id);
  assertDefined(
    posed,
    `the foe addFoe("glitch", ...) appended to the roster, read back by the ` +
      `id at the roster's end (specs/instrumentation.md, Identity)`,
  );

  await h.advanceSeconds(DRIVE_SECONDS);
  // Before the assertions, so a failing gate still leaves the picture of the
  // glitch on the tile it should never have left.
  captureStill(h, "gated");

  const held = foeById(h.snapshot(), id);
  assertCloseTo(
    held?.x ?? Number.NaN,
    posed?.x ?? Number.NaN,
    HOLD_DIGITS,
    `the glitch's center x after ${DRIVE_SECONDS} s of game time with ` +
      `setFoeTravel(${id}, false) held — its resting velocity would carry it ` +
      `GLITCH_H_SPEED (${GLITCH_H_SPEED}) units in that second (specs/foes.md)`,
  );
  assertCloseTo(
    held?.y ?? Number.NaN,
    posed?.y ?? Number.NaN,
    HOLD_DIGITS,
    `the glitch's center y after ${DRIVE_SECONDS} s of game time with ` +
      `setFoeTravel(${id}, false) held — it descends at GLITCH_V_SPEED ` +
      `(${GLITCH_V_SPEED}) units per second (specs/foes.md)`,
  );
});
