// instrumentation/reset-pointer-dragging — a reset clears the drag bit, so no
// live press is being followed as an orbit drag.
//
// `specs/instrumentation.md` § The run and the screens states the pointer field
// by field, and this is the `dragging` row: "`dragging` | `false` | The move on
// which a live press reaches `CLICK_SLOP` (`6`) from where it went down sets it
// `true`, and the release sets it `false` (`specs/controls.md`)." The column the
// figure sits in is what a `reset` leaves: `false`.
//
// SO A DRAG IS UNDER WAY WHEN THE RESET RUNS. The press goes down and the pointer
// then travels far past `CLICK_SLOP` without being released — `specs/controls.md`:
// "A press whose pointer reaches `CLICK_SLOP` from that position is an orbit drag
// from that moment until it is released, whether or not the pointer comes back
// inside" — so the bit is set, and set by the rule the specification states
// rather than by a pose. The check reads it back before resetting, so a `false`
// afterwards is one the reset wrote.
//
// The travel is far larger than `CLICK_SLOP` so nothing about the threshold is
// marginal; where the threshold itself falls is another item's requirement. The
// check stands on the build screen with a cleared world, which is where a press
// is a click or an orbit drag, and there is nothing under the pointer to pick.

import { afterEach, beforeEach, it } from "vitest";
import { assertTrue } from "../assert";
import { CLICK_SLOP } from "../constants";
import { clearAll, createHarness, openSite, type Harness } from "../harness";

/** Where the press goes down; nothing about this position is special. */
const AT = { x: 200, y: 140 };

/** Far past `CLICK_SLOP`, so the press is unambiguously an orbit drag. */
const TRAVEL = CLICK_SLOP * 8;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("clears the drag bit", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await h.pointerDown(AT.x, AT.y);
  await h.advance(1);
  await h.pointerMove(AT.x + TRAVEL, AT.y);
  await h.advance(1);
  assertTrue(
    (await h.snapshot()).pointer.dragging,
    `the press that traveled ${TRAVEL} logical pixels, an orbit drag before ` +
      "the reset (specs/controls.md)",
  );

  await h.debug.reset();
  const dragging = (await h.snapshot()).pointer.dragging;
  await h.capture("dragging", "The drag bit a reset clears");

  assertTrue(
    !dragging,
    "pointer.dragging on a reset (specs/instrumentation.md)",
  );
});
