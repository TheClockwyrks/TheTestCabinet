// Facet — appearance/pause-control-drawn: the `playing` screen draws the PAUSE
// control, and the rectangle it reports for that control is not a bare patch of
// the background.
//
// WHAT IS BEING DECIDED. specs/ui.md lists the control among what the `playing`
// screen shows — "The pause control — A `PAUSE_LABEL` (`PAUSE`) control carrying
// the `pause` pointer target, clear of the board's extent" — and
// specs/controls.md says the same from the target's side: "the `pause` target
// [covers] one reading `PAUSE_LABEL` (`PAUSE`), each legible at the stage size".
// specs/overview.md turns that into the requirement this decides: "Every pointer
// target `specs/controls.md` names is drawn where it is reported ... so a player
// with only a touchscreen reaches every screen." A player on a touchscreen has no
// key to press: this control is the whole of their way off the board.
//
// WHY THE READING IS IN TWO HALVES, AND HOW CLOSE THAT GETS. The two halves are
// as near "the control is drawn inside its target" as this case can honestly get.
//
//   The copy — `PAUSE_LABEL` is looked for among the runs of text the frame
//   spelled, in whatever pieces the build drew them, which the shared harness's
//   `drewTextAnywhere` reads.
//
//   The rectangle — the pixels inside the `pause` target the same screen reports
//   are read off the canvas and asked to carry more than one color. Something is
//   drawn there.
//
// The two are not joined into one reading, because a text draw's coordinates
// cannot be compared against the rectangle: a build that translates its context
// before drawing reports the offset coordinates on the call and is entirely
// conformant, so a check that matched the draw's position to the rectangle would
// fail a correct build. A build whose background happens to be busy under an
// empty rectangle answers the second half spuriously, which is a false pass and
// never a false failure, and it is stated here rather than hidden.
//
// WHAT IS NOT READ. What the control looks like — specs/controls.md leaves "What
// each target looks like ... the build's to design" — nor where the rectangle
// sits, how big it is, or whether it clears the board, all of which the pointer
// items decide off the reported targets.

import { afterEach, beforeEach, it } from "vitest";
import { drawnTextLines, drewTextAnywhere } from "../case-harness/text";
import { quietRowsWithEscape, type TargetRect } from "../board";
import { assertEqual, assertGreaterThan, assertTrue } from "../assert";
import { PAUSE_LABEL } from "../constants";
import {
  captureStill,
  createHarness,
  loadBoard,
  targetById,
  type Harness,
} from "../harness";

/** The target the control carries, from specs/controls.md's table for `playing`. */
const TARGET_ID = "pause";

let h: Harness;

/**
 * How many distinct colors a reported rectangle holds, counted up to two.
 *
 * Two is the whole of what the reading needs — one color is a flat patch of
 * whatever sits behind the rectangle, and two is something drawn over it — so the
 * count stops there rather than walking the whole box for a figure nothing uses.
 * Alpha is read alongside the three channels, because a control drawn as a
 * translucent panel over the background differs from it in alpha as readily as in
 * color.
 *
 * The box is clamped to the canvas, so a build that reported a rectangle running
 * off the stage is read over whatever part of it is on the stage rather than
 * failing here on a reading error — where it sits is the pointer items' verdict,
 * not this one's.
 */
function colorsIn(target: TargetRect): number {
  const view = h.viewport();
  const origin = h.device(target.x, target.y);
  const x = Math.max(0, Math.min(h.canvas.width - 1, origin.x));
  const y = Math.max(0, Math.min(h.canvas.height - 1, origin.y));
  const width = Math.max(
    1,
    Math.min(h.canvas.width - x, Math.round(target.w * view.scale)),
  );
  const height = Math.max(
    1,
    Math.min(h.canvas.height - y, Math.round(target.h * view.scale)),
  );
  const { data } = h.ctx.getImageData(x, y, width, height);
  const seen = new Set<number>();
  for (let at = 0; at + 3 < data.length; at += 4) {
    seen.add(
      ((data[at] * 256 + data[at + 1]) * 256 + data[at + 2]) * 256 +
        data[at + 3],
    );
    if (seen.size > 1) return seen.size;
  }
  return seen.size;
}

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws the PAUSE label and puts something inside the pause target it reports", async () => {
  // Any full board answers this: what is read is the render of the `playing`
  // screen, and the run-free filler puts a gem in all sixty-four cells without
  // setting anything off.
  const posed = loadBoard(h, quietRowsWithEscape([]));
  assertEqual(posed.screen, "playing", "the screen a posed board stands on");

  // One frame, and everything it drew.
  const frame = await h.frameCalls();

  // Evidence, and no part of the verdict: the control on the live board.
  captureStill(h, "control");

  assertTrue(
    drewTextAnywhere(frame, PAUSE_LABEL),
    `the ${JSON.stringify(PAUSE_LABEL)} control drawn on the playing screen, ` +
      `among ${JSON.stringify(drawnTextLines(frame))}`,
  );

  const target = targetById(h.snapshot(), TARGET_ID);
  assertGreaterThan(
    colorsIn(target),
    1,
    `distinct colors inside the ${TARGET_ID} target the playing screen reports, ` +
      `at (${target.x},${target.y}) ${target.w}x${target.h}`,
  );
});
