// instrumentation/pointer-reads-back — the three pointer operations are
// reported, and a press is recorded.
//
// THE RULE. specs/instrumentation.md, under The pointer: `pointerDown`,
// `pointerMove` and `pointerUp` each report a press, a move, or a release at a
// logical stage point, and "Each takes effect immediately, when it is called,
// rather than being sampled once per frame ... so a whole gesture can be driven
// from code without advancing the game at all." The snapshot carries
// `pointer: { x, y, down }` for where the pointer is and whether it is held, and
// `lastPress: { x, y, at }` for "the most recent press, which the double-click
// rule is measured against", `at` being "the value `simTime` held when it
// arrived" (specs/state.md).
//
// WHY THE READING MATTERS. Every gesture-driven check in this suite presses,
// sweeps and releases through these three operations and reads the result off
// the board; this is the one point that reads the pointer ITSELF, so a build
// whose input path works but whose reporting does not fails here rather than
// leaving `handling` checks unexplainable.
//
// THE THREE POINTS DIFFER IN BOTH COORDINATES, so every wrong model reads a
// different pair: a build that reports the press point for the move reads
// `(150, 400)` where `(200, 450)` is due, one that reports the frame's last
// sample reads the release point, and one that reports nothing at all reads the
// origin `reset` leaves.
//
// EVERY POINT LIES ON BARE TABLE. The thirteen drop rectangles specs/table.md
// fixes are the top row's `y = 24..164` and the columns' `y = 180..320` on an
// empty board, and the HUD strip is `y = 680..716`; all three points are
// between `y = 400` and `y = 500`, so no card is lifted, no control is
// activated and no stock is turned, and what is read is the reporting alone.
//
// AND A FRAME IS ADVANCED BEFORE THE PRESS, so `simTime` is not zero when the
// press arrives: `at` is then a figure a build that wrote `0`, or that wrote a
// wall-clock reading, cannot match.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertDeepEqual, assertGreaterThan } from "../assert";
import {
  captureStill,
  createHarness,
  movePointerTo,
  openTable,
  pressAt,
  releaseAt,
  type Harness,
} from "../harness";

/** The press, the move and the release, all on bare table and all distinct. */
const PRESS = { x: 150, y: 400 };
const MOVE = { x: 200, y: 450 };
const RELEASE = { x: 260, y: 500 };

/**
 * How close `lastPress.at` must lie to the `simTime` the press arrived at.
 *
 * The two are the same number — `at` IS that reading (specs/state.md) — so the
 * bound is a floating-point one rather than a physical tolerance: a sixtieth of
 * a second is `0.016…`, and a build that wrote `0`, the frame count, or a
 * wall-clock reading misses by orders of magnitude more than this.
 */
const AT_TOLERANCE_DIGITS = 6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reports the press, the move and the release, and records the press", async () => {
  openTable(h);
  // One frame, so the press arrives at a simTime that is not zero.
  await h.advance(1);
  const clock = h.snapshot().simTime;
  assertGreaterThan(clock, 0, "the simTime the press arrives at");

  pressAt(h, PRESS.x, PRESS.y);
  const pressed = h.snapshot();

  movePointerTo(h, MOVE.x, MOVE.y);
  const moved = h.snapshot();

  releaseAt(h, RELEASE.x, RELEASE.y);
  const released = h.snapshot();

  await h.advance(1);
  captureStill(h, "pointer");

  assertDeepEqual(
    pressed.pointer,
    { x: PRESS.x, y: PRESS.y, down: true },
    "the pointer reported after pointerDown, which takes effect at the call " +
      "(specs/instrumentation.md)",
  );
  assertDeepEqual(
    moved.pointer,
    { x: MOVE.x, y: MOVE.y, down: true },
    "the pointer reported after pointerMove, still held " +
      "(specs/instrumentation.md)",
  );
  assertDeepEqual(
    released.pointer,
    { x: RELEASE.x, y: RELEASE.y, down: false },
    "the pointer reported after pointerUp (specs/instrumentation.md)",
  );

  assertDeepEqual(
    pressed.lastPress === null
      ? null
      : { x: pressed.lastPress.x, y: pressed.lastPress.y },
    { x: PRESS.x, y: PRESS.y },
    "the point lastPress recorded for the press: every press records its " +
      "point, and that is the press the next one is measured against " +
      "(specs/controls.md)",
  );
  assertCloseTo(
    pressed.lastPress?.at ?? Number.NaN,
    clock,
    AT_TOLERANCE_DIGITS,
    "the game time lastPress recorded for the press, against the simTime it " +
      "arrived at (specs/state.md)",
  );
});
