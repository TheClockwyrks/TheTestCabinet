// instrumentation/pointer-reads-back — the pointer the surface drives is the
// pointer the snapshot reports, and every press is recorded.
//
// THE RULE. `specs/instrumentation.md` gives the snapshot two pointer fields:
// `pointer` (`{ x, y, down }`), and `lastPress`, "the most recent press, which
// the double-click rule is measured against", carrying its point and the game
// time it arrived at. `specs/controls.md` states the recording itself: "Every
// press records its point and the game time it arrived at, and that is the press
// the next one is measured against."
//
// SO THE THREE OPERATIONS ARE DRIVEN IN TURN AND EACH ONE'S OWN READING IS TAKEN.
// A press moves the pointer to its point and puts it down; a move carries it to a
// second point with the button still down; a release leaves it at a third point
// and up. Three different points, so a build reporting the press point forever, or
// the pointer's position at the last frame, reads a different number at every
// step and the failure names which operation.
//
// THE PRESS'S TIME IS READ AGAINST THE GAME'S OWN CLOCK. `lastPress.at` is the
// game time the press arrived at and the double-click window is measured in
// seconds of game time (`specs/controls.md`), so a quarter of a second is
// advanced before the press and the recorded time is held to the `simTime` the
// same snapshot reports. A build stamping the wall clock, or the frame count,
// misses by orders of magnitude; one stamping zero misses by the quarter second.
//
// THE TABLE IS EMPTY AND THE POINTS ARE CLEAR OF EVERYTHING. The requirement is
// the reporting of the pointer, so the gesture must pick nothing up, activate no
// control and turn no stock: the three points lie below the columns' empty drop
// rectangles and well above the HUD strip, on a table `openTable` left with no
// card on it at all.
//
// WHAT THIS DOES NOT DECIDE. What a press PICKS UP, what the drag threshold
// separates, or what the double click does with two of them — `handling/*` owns
// all three. This point decides only that the surface's pointer is observable.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  framesFor,
  openTable,
  type Harness,
} from "../harness";

/**
 * The three points the gesture visits, all on empty felt.
 *
 * They sit at `y` well below `TABLEAU_Y + CARD_H` (`320`), which is as far as an
 * empty column's drop rectangle reaches, and well above `HUD_Y` (`680`), so no
 * pile and no control answers any of them (`specs/table.md`,
 * `specs/controls.md`). All three differ in both coordinates.
 */
const PRESS = { x: 300, y: 400 };
const MOVE = { x: 520, y: 452 };
const RELEASE = { x: 744, y: 508 };

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

afterEach(async () => {
  await h.dispose();
});

it("reports the pointer it is driven with, and records the press", async () => {
  await openTable(h);
  await h.advance(framesFor(LEAD_SECONDS));

  await h.debug.pointerDown(PRESS.x, PRESS.y);
  const pressed = await h.snapshot();

  await h.debug.pointerMove(MOVE.x, MOVE.y);
  const moved = await h.snapshot();

  await h.debug.pointerUp(RELEASE.x, RELEASE.y);
  const released = await h.snapshot();

  await h.advance(1);
  // Before the assertions, so a failing reading still leaves the picture of the
  // board the pointer was driven over.
  await captureStill(h, "pointer");

  assertEqual(
    `${pressed.pointer.x},${pressed.pointer.y},${pressed.pointer.down}`,
    `${PRESS.x},${PRESS.y},true`,
    `snapshot().pointer after pointerDown(${PRESS.x}, ${PRESS.y})`,
  );
  assertEqual(
    `${moved.pointer.x},${moved.pointer.y},${moved.pointer.down}`,
    `${MOVE.x},${MOVE.y},true`,
    `snapshot().pointer after pointerMove(${MOVE.x}, ${MOVE.y}), the button ` +
      `still down`,
  );
  assertEqual(
    `${released.pointer.x},${released.pointer.y},${released.pointer.down}`,
    `${RELEASE.x},${RELEASE.y},false`,
    `snapshot().pointer after pointerUp(${RELEASE.x}, ${RELEASE.y})`,
  );

  assertEqual(
    pressed.lastPress === null,
    false,
    `snapshot().lastPress after pointerDown(${PRESS.x}, ${PRESS.y}) — every ` +
      `press records its point and the game time it arrived at ` +
      `(specs/controls.md)`,
  );
  const press = pressed.lastPress;
  if (press !== null) {
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
        `same snapshot reports — the double-click window is measured in ` +
        `seconds of game time (specs/controls.md)`,
    );
  }
});
