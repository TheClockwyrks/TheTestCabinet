// instrumentation/pointer-reads-back — the pointer's three operations are reported
// by the snapshot.
//
// specs/instrumentation.md: `pointerDown`, `pointerMove` and `pointerUp` each
// "report" a press, a move or a release at a logical stage point, each takes effect
// immediately rather than being sampled once per frame, and `snapshot` reports
// `pointer: { x, y, down }` and `lastPress: { x, y, at }`, the last press being
// "written by the pointer path rather than posed, and it is reported here so the
// double-click rule is observable".
//
// WHY THE SUITE RESTS ON IT. Every gesture in this project is driven through those
// three, and `drag`, `clickAt` and `doubleClickAt` in `harness.ts` compose whole
// gestures out of them without advancing a frame. A build that queued them for the
// next frame, or that reported the pointer somewhere other than where it was put,
// would put every one of those gestures somewhere the check did not aim it.
//
// NO FRAME RUNS BETWEEN THE THREE, which is the point: each is read on the state
// the call before it left, so what is being asserted is exactly the "resolved
// before the call returns" the specification states.
//
// THE THREE POINTS ARE FAR APART AND ON BARE FELT. The table is empty, so a press
// lifts nothing and the reading is of the pointer alone (specs/controls.md); the
// points lie clear of every pile's rectangle, of the stock, and of the HUD strip,
// so no control answers and the game does nothing but record where the pointer
// went. The release is far from the press, so the gesture is a drop rather than a
// click, and a drop with nothing in hand changes nothing.
//
// `lastPress.at` IS READ AGAINST A CLOCK THAT HAS RUN. A quarter of a second of
// game time is advanced before the press, so a build that reported `0`, or that
// reported the time of some later frame, reads as a different number from the
// `simTime` the press really arrived at.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertEqual, assertNotNull } from "../assert";
import {
  captureStill,
  createHarness,
  framesFor,
  openTable,
  type Harness,
} from "../harness";

/** The three points the gesture visits, all on bare felt and far apart. */
const PRESS = { x: 137.5, y: 402.25 };
const MOVE = { x: 642.5, y: 512.75 };
const RELEASE = { x: 911.25, y: 271.5 };

/** How long the game is run before the press, so `simTime` is plainly not zero. */
const WARMUP_FRAMES = framesFor(0.25);

/** Six decimal places: float noise, not a rounding a build may choose. */
const EXACT = 6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reports each of the three, and the press it was measured from", async () => {
  openTable(h);
  await h.advance(WARMUP_FRAMES);

  const pressedAt = h.snapshot().simTime;
  h.debug.pointerDown(PRESS.x, PRESS.y);
  const down = h.snapshot();

  h.debug.pointerMove(MOVE.x, MOVE.y);
  const moved = h.snapshot();

  h.debug.pointerUp(RELEASE.x, RELEASE.y);
  const up = h.snapshot();

  // The board the pointer was driven over.
  await h.advance(1);
  captureStill(h, "pointer");

  assertCloseTo(down.pointer.x, PRESS.x, EXACT, "pointerDown's x");
  assertCloseTo(down.pointer.y, PRESS.y, EXACT, "pointerDown's y");
  assertEqual(down.pointer.down, true, "the pointer is down after a press");

  assertCloseTo(moved.pointer.x, MOVE.x, EXACT, "pointerMove's x");
  assertCloseTo(moved.pointer.y, MOVE.y, EXACT, "pointerMove's y");
  assertEqual(
    moved.pointer.down,
    true,
    "the pointer is still down through a move",
  );

  assertCloseTo(up.pointer.x, RELEASE.x, EXACT, "pointerUp's x");
  assertCloseTo(up.pointer.y, RELEASE.y, EXACT, "pointerUp's y");
  assertEqual(up.pointer.down, false, "the pointer is up after a release");

  assertNotNull(
    down.lastPress,
    "lastPress after a press: every press records its point and the game time " +
      "it arrived at (specs/controls.md)",
  );
  if (down.lastPress !== null) {
    assertCloseTo(down.lastPress.x, PRESS.x, EXACT, "lastPress's x");
    assertCloseTo(down.lastPress.y, PRESS.y, EXACT, "lastPress's y");
    assertCloseTo(
      down.lastPress.at,
      pressedAt,
      EXACT,
      "lastPress's at, which is the simTime the press arrived at " +
        "(specs/instrumentation.md)",
    );
  }
});
