// instrumentation/press-position-rests-where-the-press-began — pressX and pressY
// stay where the last press went down.
//
// specs/instrumentation.md gives the pointer's six fields a table of their own,
// and this is the row for two of them: "`pressX` — A press writes the position it
// went down at, and a release leaves it, so it rests where the last press began."
// The Snapshot shape block adds the units: "`pointer.pressX` and
// `pointer.pressY` are in the same logical stage units as `pointer.x` and
// `pointer.y`."
//
// So the gesture is one press that MOVES before it is released, and one move
// afterwards, and the reading separates three things a build might be keeping in
// one place: where the pointer is now, where the press began, and whether a press
// is live. A build that wrote the press position on every move reports the drag's
// end; one that cleared it on release reports the last move, or zero; one that
// kept it right reports where the finger went down, which is what
// `specs/controls.md` measures `CLICK_SLOP` from.
//
// The press is a DRAG rather than a click — a hundred logical pixels, well past
// `CLICK_SLOP` (`6`) — because that is the gesture in which the two readings come
// apart. The yard is emptied and the structure cleared first so the drag operates
// nothing but the camera: this check is about the six fields and not about what a
// press does with them.
//
// Each act is followed by a frame, because "a build is free to act on an event as
// it arrives or on the frame that reads it" (specs/instrumentation.md), and
// `pointer.x` is a field "every update reads the pointer's current position into".

import { afterEach, beforeEach, it } from "vitest";
import { assertClose, assertEqual } from "../assert";
import { createHarness, emptyYard, openSite, type Harness } from "../harness";

/** Where the press goes down, where it is dragged to, and where it ends up. */
const DOWN = { x: 120, y: 80 };
const DRAG = { x: 200, y: 140 };
const AFTER = { x: 40, y: 40 };

/**
 * Half a logical pixel: `specs/state.md` fixes the units the pointer position is
 * held in and not its precision, so a build is free to keep it at whole pixels.
 */
const TOL = 0.5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves pressX and pressY where the press went down after it is released", async () => {
  await openSite(h, 0);
  await emptyYard(h);

  await h.pointerDown(DOWN.x, DOWN.y);
  await h.advance(1);
  await h.pointerMove(DRAG.x, DRAG.y);
  await h.advance(1);
  await h.pointerUp();
  await h.advance(1);
  await h.pointerMove(AFTER.x, AFTER.y);
  await h.advance(1);

  const { pointer } = await h.snapshot();

  assertClose(
    pointer.pressX,
    DOWN.x,
    TOL,
    "pressX after the press was dragged and released " +
      "(specs/instrumentation.md)",
  );
  assertClose(
    pointer.pressY,
    DOWN.y,
    TOL,
    "pressY after the press was dragged and released " +
      "(specs/instrumentation.md)",
  );

  // Read beside them, so a build that simply froze the whole pointer cannot
  // pass: the position is the last move's, and no press is live.
  assertClose(
    pointer.x,
    AFTER.x,
    TOL,
    "the pointer position after the release",
  );
  assertClose(
    pointer.y,
    AFTER.y,
    TOL,
    "the pointer position after the release",
  );
  assertEqual(pointer.down, false, "the press the release ended");

  await h.capture(
    "press-position",
    "The pointer resting where the last press began",
  );
});
