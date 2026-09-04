// instrumentation/pointer-down-reported — the press the surface drives is the
// press the snapshot reports.
//
// THE RULE. `specs/instrumentation.md` gives the snapshot a `pointer` field,
// `{ x, y, down }`, and `pointerDown(x, y)` "Reports a press at a logical stage
// point", taking effect "immediately, when it is called, rather than being
// sampled once per frame".
//
// WHY EACH OPERATION IS ITS OWN POINT. Every handling suite in this checklist
// drives the pointer, so a build that reports the position but never the button —
// or that reports the press and then never moves — has broken a different thing
// each time, and the grade says which. `pointer-move-reported`,
// `pointer-up-reported` and `last-press-reported` are the other three.
//
// THE POINT IS ON EMPTY FELT. The requirement is the REPORTING of the press, so
// the press must pick nothing up, activate no control and turn no stock: it lies
// at a `y` well below `TABLEAU_Y + CARD_H` (`320`), which is as far as an empty
// column's drop rectangle reaches, and well above `HUD_Y` (`680`), on a table
// `openTable` left with no card on it at all.
//
// BOTH COORDINATES DIFFER FROM THE `(0, 0)` `reset` leaves the pointer at, so a
// build that reports a constant is caught.
//
// WHAT THIS DOES NOT DECIDE. What a press PICKS UP, which is `handling/*`'s.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  openTable,
  type Harness,
} from "../harness";

/** The point pressed: empty felt, and neither coordinate the reset's `0`. */
const PRESS = { x: 300, y: 400 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reports the press point and the button down", async () => {
  openTable(h);

  h.debug.pointerDown(PRESS.x, PRESS.y);
  // Read before a frame runs: the operation resolves at the call, so nothing is
  // waiting on an update (specs/instrumentation.md).
  const pressed = h.snapshot();

  await h.advance(1);
  // Before the assertion, so a failing reading still leaves the picture of the
  // board the press was driven onto.
  captureStill(h, "pointer");

  assertEqual(
    `${pressed.pointer.x},${pressed.pointer.y},${pressed.pointer.down}`,
    `${PRESS.x},${PRESS.y},true`,
    `snapshot().pointer after pointerDown(${PRESS.x}, ${PRESS.y}) ` +
      `(specs/instrumentation.md)`,
  );
});
