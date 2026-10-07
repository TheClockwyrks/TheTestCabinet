// instrumentation/pointer-move-reported — the move the surface drives is the move
// the snapshot reports, and it leaves the button as the gesture left it.
//
// THE RULE. `specs/instrumentation.md`: `pointerMove(x, y)` "Reports a move to a
// logical stage point", and the snapshot's `pointer` carries `{ x, y, down }`. A
// move is not a press, so the button stays exactly where the gesture put it.
//
// WHY IT IS ITS OWN POINT. `pointer-down-reported` and `pointer-up-reported` are
// the other two edges, and a build can report a press and then never carry the
// pointer with it — which is what makes every drop in the `handling` group land
// where the press was rather than where the release was.
//
// THE MOVE IS MADE WITH THE BUTTON DOWN, which is the state a drag is in, and the
// reading holds `down` at `true` afterwards: a build that treats a move as a
// release is caught here rather than in the suite whose drop it silently broke.
//
// THE TWO POINTS ARE ON EMPTY FELT AND DIFFER IN BOTH COORDINATES, so nothing is
// picked up, no control answers, and a build that reports the press point forever
// reads a different number.
//
// WHAT THIS DOES NOT DECIDE. That a held run FOLLOWS the pointer, which is
// `handling/run-follows-pointer`'s.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  openTable,
  type Harness,
} from "../harness";

/** The two points the gesture visits, both on empty felt. */
const PRESS = { x: 300, y: 400 };
const MOVE = { x: 520, y: 452 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reports the moved-to point and leaves the button down", async () => {
  openTable(h);

  h.debug.pointerDown(PRESS.x, PRESS.y);
  h.debug.pointerMove(MOVE.x, MOVE.y);
  // Read before a frame runs: the operation resolves at the call.
  const moved = h.snapshot();

  await h.advance(1);
  captureStill(h, "pointer");

  assertEqual(
    `${moved.pointer.x},${moved.pointer.y},${moved.pointer.down}`,
    `${MOVE.x},${MOVE.y},true`,
    `snapshot().pointer after pointerMove(${MOVE.x}, ${MOVE.y}) made with the ` +
      `button down (specs/instrumentation.md) — a move is not a release, so ` +
      `the button is left as the gesture left it`,
  );
});
