// controls/dragging-turns-true-on-the-slop-crossing — `pointer.dragging` turns
// true on the move that reaches `CLICK_SLOP`.
//
// `specs/controls.md` § Clicks and drags: "A press whose pointer stays less than
// `CLICK_SLOP` (`6`) logical pixels from the position it went down at is a click
// ... A press whose pointer reaches `CLICK_SLOP` from that position is an orbit
// drag from that moment until it is released."
// `specs/instrumentation.md` says the state reports exactly that: "`dragging` —
// The move on which a live press reaches `CLICK_SLOP` (`6`) from where it went
// down sets it `true`".
//
// SO THE BOUNDARY IS READ FROM BOTH SIDES, and the distance is measured from
// where the press WENT DOWN rather than from the previous move. The press goes
// down; a move to `INSIDE_PX` (`5`) reads false, because five is less than six; a
// move to exactly `CLICK_SLOP` reads true, because six reaches it. One pixel
// separates the two readings, which is what makes this the boundary rather than a
// reading somewhere either side of it.
//
// The two moves are made in that order, so the second is one pixel further from
// the press position and only a build measuring from the press position sees it
// cross. A build measuring each move on its own sees a one-pixel move and stays
// inside.
//
// A frame runs after each act, because "a build is free to act on an event as it
// arrives or on the frame that reads it, so a caller that needs the game to have
// consumed one runs a frame after it" (`specs/instrumentation.md`).

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { CLICK_SLOP, STAGE_H, STAGE_W } from "../constants";
import { createHarness, openSite, type Harness } from "../harness";

/** Where the press goes down: the middle of the stage. */
const PRESS = { x: STAGE_W / 2, y: STAGE_H / 2 } as const;

/** The last distance that is still a click: one pixel short of the boundary. */
const INSIDE_PX = CLICK_SLOP - 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reads false a pixel short of CLICK_SLOP and true at it", async () => {
  await openSite(h, 0);

  await h.pointerDown(PRESS.x, PRESS.y);
  await h.advance(1);
  assertEqual(
    (await h.snapshot()).pointer.dragging,
    false,
    "pointer.dragging under a press that has not moved (specs/controls.md)",
  );

  await h.pointerMove(PRESS.x + INSIDE_PX, PRESS.y);
  await h.advance(1);
  assertEqual(
    (await h.snapshot()).pointer.dragging,
    false,
    `pointer.dragging with the pointer ${INSIDE_PX} logical pixels from the ` +
      `press, less than CLICK_SLOP (${CLICK_SLOP}) (specs/controls.md)`,
  );

  await h.pointerMove(PRESS.x + CLICK_SLOP, PRESS.y);
  await h.advance(1);
  assertEqual(
    (await h.snapshot()).pointer.dragging,
    true,
    `pointer.dragging on the move that reaches CLICK_SLOP (${CLICK_SLOP}) ` +
      "from where the press went down (specs/controls.md)",
  );

  await h.capture("state", "the yard under a press that has become a drag");
  await h.pointerUp();
  await h.advance(1);
});
