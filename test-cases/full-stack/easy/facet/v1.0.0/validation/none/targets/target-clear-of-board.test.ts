// Facet — targets/target-clear-of-board: the pause control keeps off the board.
//
// specs/controls.md gives the `playing` screen one extra sentence beyond the four
// requirements every target meets: "On `playing` the `pause` target lies wholly
// outside the board's extent, which `specs/board.md` gives, so it never covers a
// cell." specs/ui.md draws the same conclusion from the other side, listing "A
// `PAUSE_LABEL` (`PAUSE`) control carrying the `pause` pointer target, clear of
// the board's extent."
//
// WHY IT MATTERS, AND WHY NO OTHER POINT SEES IT. specs/controls.md plays the
// board "everywhere outside that screen's `pause` target", so wherever the
// control reaches, the board does not: a cell under it cannot be selected,
// carried onto, or released over. The board becomes unplayable in patches. Every
// pointer point in this checklist presses in the middle of the board and every
// target point presses at a target's own center, so none of them would ever land
// in the overlap.
//
// WHAT THE EXTENT IS, AND WHY `GEM_HIT_R` RATHER THAN `GEM_R`. `board.ts`'s
// `boardExtent` is the span of cell centers specs/board.md gives — `x` `388..892`
// and `y` `144..648` — grown by `GEM_HIT_R` (`36`) on every side, so it runs `x`
// `352..928` and `y` `108..684`. A cell is covered wherever the pointer would
// TARGET it, and specs/controls.md puts that at `GEM_HIT_R` of its center rather
// than at the `GEM_R` (`30`) a gem's drawn form fits inside. That is the reading
// under which the specification's own stated consequence — the control "never
// covers a cell" — actually holds, so it is the one this measures. It is also the
// stricter of the two, by six units on each side, and the description the review
// item states is the drawn extent it contains.
//
// THE RECTANGLE IS THE BUILD'S, READ OFF THE SNAPSHOT. The case fixes no target,
// so this check asks the game where its pause control is and holds THAT rectangle
// to the sentence. Sharing an edge with the extent is not covering a cell:
// `targetsOverlap`, which `targetClearsBoard` is the negation of, is strict on
// every edge.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertTrue } from "../assert";
import { boardExtent, quietRowsWithEscape, targetClearsBoard } from "../board";
import {
  captureStill,
  createHarness,
  loadBoard,
  targetById,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("keeps the pause target off the board's extent", async () => {
  // A posed board puts the game on `playing`, which is the one screen the
  // sentence is about and the one screen that carries a `pause` target.
  const opened = await loadBoard(h, quietRowsWithEscape([]));
  assertEqual(opened.screen, "playing", "the screen the control is read on");

  const pause = targetById(opened, "pause");
  const board = boardExtent();

  // The frame that draws the board and the control together, and the picture of
  // the two standing clear of each other.
  await h.advance(1);
  await captureStill(h, "playing");

  assertTrue(
    targetClearsBoard(pause),
    `the pause target runs from (${pause.x},${pause.y}) to ` +
      `(${pause.x + pause.w},${pause.y + pause.h}), against the board's extent ` +
      `from (${board.x},${board.y}) to (${board.x + board.w},${board.y + board.h})`,
  );
});
