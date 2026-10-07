// instrumentation/pointer-up-reported — the release the surface drives is the
// release the snapshot reports.
//
// THE RULE. `specs/instrumentation.md`: `pointerUp(x, y)` "Reports a release at a
// logical stage point", and the snapshot's `pointer` carries `{ x, y, down }`.
//
// WHY IT IS ITS OWN POINT. A build that reports a press and never clears the
// button leaves every gesture in the `handling` group looking like one that never
// ended, which is a different defect from one that never reports the press at
// all. `pointer-down-reported` and `pointer-move-reported` are the other two
// edges.
//
// THE RELEASE POINT IS A THIRD POINT, differing from the press and the move in
// both coordinates, so a build that reports the pointer's position at the last
// frame, or the press point forever, reads a different number.
//
// EVERY POINT IS ON EMPTY FELT, so the gesture picks nothing up, activates no
// control and turns no stock: the requirement is the reporting alone.
//
// WHAT THIS DOES NOT DECIDE. What a release RESOLVES — a click, a drop, or
// nothing — which is `handling/*`'s.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  openTable,
  type Harness,
} from "../harness";

/** The three points the gesture visits, all on empty felt. */
const PRESS = { x: 300, y: 400 };
const MOVE = { x: 520, y: 452 };
const RELEASE = { x: 744, y: 508 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reports the release point and the button up", async () => {
  await openTable(h);

  await h.debug.pointerDown(PRESS.x, PRESS.y);
  await h.debug.pointerMove(MOVE.x, MOVE.y);
  await h.debug.pointerUp(RELEASE.x, RELEASE.y);
  // Read before a frame runs: the operation resolves at the call.
  const released = await h.snapshot();

  await h.advance(1);
  await captureStill(h, "pointer");

  assertEqual(
    `${released.pointer.x},${released.pointer.y},${released.pointer.down}`,
    `${RELEASE.x},${RELEASE.y},false`,
    `snapshot().pointer after pointerUp(${RELEASE.x}, ${RELEASE.y}) ` +
      `(specs/instrumentation.md)`,
  );
});
