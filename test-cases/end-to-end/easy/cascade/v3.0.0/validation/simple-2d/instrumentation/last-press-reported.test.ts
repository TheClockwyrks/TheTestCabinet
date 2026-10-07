// instrumentation/last-press-reported — every press records its point and the
// game time it arrived at, and the snapshot reports both.
//
// THE RULE. `specs/controls.md`: "Every press records its point and the game time
// it arrived at, and that is the press the next one is measured against."
// `specs/instrumentation.md` puts the reading on the snapshot: `lastPress`, "the
// most recent press, which the double-click rule is measured against ... `reset`
// clears it."
//
// WHY IT IS ITS OWN POINT. It is the field the whole double-click rule is
// measured against, and it fails independently of the three pointer readings: a
// build can report `pointer` perfectly and never write `lastPress`, which leaves
// every double click in the `handling` group deciding something else.
//
// THE PRESS'S TIME IS READ AGAINST THE GAME'S OWN CLOCK. `lastPress.at` is the
// game time the press arrived at and the double-click window is measured in
// seconds of game time (`specs/controls.md`), so a quarter of a second is
// advanced before the press and the recorded time is held to the `simTime` the
// same snapshot reports. A build stamping the wall clock, or the frame count,
// misses by orders of magnitude; one stamping zero misses by the quarter second.
//
// THE POINT IS ON EMPTY FELT, so the press picks nothing up and activates no
// control: the requirement is the recording alone.
//
// WHAT THIS DOES NOT DECIDE. What the double-click rule then DOES with the
// record, which is `handling/*`'s.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  framesFor,
  openTable,
  type Harness,
} from "../harness";

/** The point pressed: empty felt, and neither coordinate the reset's `0`. */
const PRESS = { x: 300, y: 400 };

/**
 * Game time run before the press, in seconds.
 *
 * So `lastPress.at` is read at a value that is neither zero nor the wall clock. A
 * quarter of a second is comfortably inside no rule this point touches, and it is
 * a whole number of frames at the suite's step.
 */
const LEAD_SECONDS = 0.25;

/**
 * How far the recorded press time may sit from the game time of the same
 * snapshot, in decimal digits for `assertCloseTo`.
 *
 * Nine, which is half a nanosecond: the press is stamped with the game time it
 * arrived at, and the only distance from `simTime` is the sum of sixty doubles.
 * This is that arithmetic and not room for another reading of the rule.
 */
const TIME_DIGITS = 9;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("records the press point and the game time it arrived at", async () => {
  openTable(h);
  await h.advance(framesFor(LEAD_SECONDS));

  h.debug.pointerDown(PRESS.x, PRESS.y);
  // Read before a frame runs: the operation resolves at the call.
  const pressed = h.snapshot();

  await h.advance(1);
  // Before the assertions, so a failing reading still leaves the picture of the
  // board the recorded press landed on.
  captureStill(h, "press");

  const press = pressed.lastPress;
  assertEqual(
    press === null,
    false,
    `snapshot().lastPress after pointerDown(${PRESS.x}, ${PRESS.y}) — every ` +
      `press records its point and the game time it arrived at ` +
      `(specs/controls.md)`,
  );
  if (press === null) return;

  assertEqual(
    `${press.x},${press.y}`,
    `${PRESS.x},${PRESS.y}`,
    "the point snapshot().lastPress recorded for that press",
  );
  assertCloseTo(
    press.at,
    pressed.simTime,
    TIME_DIGITS,
    `the game time snapshot().lastPress recorded, against the simTime the ` +
      `same snapshot reports — the double-click window is measured in seconds ` +
      `of game time (specs/controls.md)`,
  );
});
