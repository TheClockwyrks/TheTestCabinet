// Facet — targets/hover-highlights-menu: moving over a menu item highlights it.
//
// The first row of specs/controls.md's table of what the pointer does to a
// screen: "Moves within a `menu-<i>` target while pressed on nothing —
// `state.menuIndex` becomes `i`." So a hover is what a mouse-holding player
// expects it to be, and the index it sets is the target's own — `menu-1` sets
// `1`, which is what makes the ids ordered rather than merely present.
//
// AND NOTHING MOVES THE HIGHLIGHT OFF AN ITEM. The table has one row about moving
// and it only ever sets an index; there is no row that clears one. So a pointer
// carried off the menu entirely leaves the highlight where the last item it
// crossed put it, and a build that reset the index — to `0`, or to nothing — when
// the pointer left would flicker the menu under an ordinary sweep of the mouse
// and would take the wrong item on a keyboard `confirm` that followed. The second
// half of this check is that reading.
//
// THE MOVE IS DRIVEN AT THE RECTANGLE THE BUILD REPORTED. The case fixes no
// target, and specs/instrumentation.md guarantees exactly one position:
// "a target's rectangle is the one the game actually hit-tests against, so
// pressing and releasing at a listed target's center takes that target." The
// center is therefore the one point a check may aim at without asserting anything
// about the build's layout. A build whose menu is DRAWN somewhere other than it
// hit-tests answers this point and fails `appearance`'s, which is the right
// division: the two are different faults.
//
// WHERE THE POINTER GOES AFTERWARDS is computed from the reported rectangles
// rather than written down — a lattice of stage positions is walked and the first
// that lies in none of them is taken — because a point written down could land
// inside a menu a build laid out differently, and the check would then be reading
// the first row again instead of the absence of a second.
//
// NOTHING IS PRESSED. The row is about a move "while pressed on nothing", and the
// press has its own row and its own point in `targets/press-arms-target`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, fail } from "../assert";
import { STAGE_H, STAGE_W } from "../constants";
import type { TargetRect } from "../board";
import {
  captureStill,
  createHarness,
  movePointer,
  moveOverTarget,
  targetById,
  type Harness,
} from "../harness";

/** The item the hover lands on: the second, so the index it sets is not the resting one. */
const WANTED = "menu-1";

/** The index `menu-1` names, which is the `i` of its id. */
const WANTED_INDEX = 1;

/** How far apart the lattice of candidate positions is walked, in stage units. */
const LATTICE_STEP = 40;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** Whether a stage point lies inside a target's rectangle, its edges counted in. */
function insideTarget(
  point: { x: number; y: number },
  target: TargetRect,
): boolean {
  return (
    point.x >= target.x &&
    point.x <= target.x + target.w &&
    point.y >= target.y &&
    point.y <= target.y + target.h
  );
}

/**
 * A stage position lying in none of `targets`, found by walking a lattice.
 *
 * `null` when the screen's targets cover every position tried, which no screen
 * meeting the requirements in `targets/targets-min-size` and
 * `targets/targets-on-stage` can do — so the caller reports it as a reading it
 * could not take rather than passing quietly.
 */
function pointClearOfAll(
  targets: readonly TargetRect[],
): { x: number; y: number } | null {
  for (let y = LATTICE_STEP; y < STAGE_H; y += LATTICE_STEP) {
    for (let x = LATTICE_STEP; x < STAGE_W; x += LATTICE_STEP) {
      const point = { x, y };
      if (!targets.some((target) => insideTarget(point, target))) return point;
    }
  }
  return null;
}

it("sets menuIndex to the item the pointer moved over, and leaves it there", async () => {
  // The title screen, at its first item: the index has somewhere to move to.
  await h.debug.reset();
  const opened = await h.snapshot();
  assertEqual(opened.screen, "title", "the screen the hover is read on");
  assertEqual(opened.menuIndex, 0, "the highlighted item before the hover");

  const second = targetById(opened, WANTED);
  const hovered = await moveOverTarget(h, second);

  // The frame that draws the highlight the pointer moved, and the picture of it.
  await h.advance(1);
  await captureStill(h, "hover");

  assertEqual(
    hovered.menuIndex,
    WANTED_INDEX,
    `the highlighted item after a move inside ${WANTED}`,
  );
  assertEqual(
    hovered.screen,
    "title",
    "the screen, which a move does not take",
  );

  // And off every target, which the table gives no row at all.
  const away = pointClearOfAll(hovered.targets);
  if (away === null) {
    fail(
      `a stage position clear of every target the title screen reports`,
      hovered.targets.map((target) => target.id),
    );
  }
  const left = await movePointer(h, away.x, away.y);
  assertEqual(
    left.menuIndex,
    WANTED_INDEX,
    "the highlighted item after the pointer left the menu, which the table " +
      "never moves off an item",
  );
});
