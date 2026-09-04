// controls/pointer-reaches-a-menu-row — moving the pointer onto a menu row
// highlights it, and takes nothing.
//
// THE RULE. `specs/controls.md`, on what moving the pointer does: "Moving onto a
// row of the menu the current screen shows makes that row the highlighted row,
// exactly as `up` and `down` reaching it do ... Moving off every row leaves the
// highlight on the row it last reached, and moving onto the already highlighted
// row changes nothing and raises nothing. Hovering a row takes it no further:
// reaching a row and taking it are separate."
//
// SO THERE ARE THREE READINGS AND THEY ARE ONE REQUIREMENT: the highlight follows
// the pointer onto a row, the screen does NOT follow it — reaching is not taking —
// and moving off every row leaves the highlight where it last landed. A build that
// took the row on hover fails the second, and one that cleared the highlight on
// the way out fails the third; both are the same defect in the same sentence, and
// grading them apart would say nothing a reviewer could act on differently.
//
// THE POINTER IS DRIVEN AT THE RECTANGLE THE BUILD REPORTED, which is what makes
// this decidable at all: `specs/screens.md` leaves the layout of a menu entirely
// to the build and has it report each row's rectangle. That the rectangles are
// reported is `screens.menu-rows-reported`'s requirement, so a build that reports
// none fails there; this one drives what it reported.
//
// THE TITLE SCREEN, AND THE SECOND ROW. The title is the menu a player meets first
// and it needs nothing posed to reach; the second row is not the one the screen is
// posed on, so a build whose pointer moves nothing reads `0` where `1` is due.
// The row is deliberately NOT taken here, so the screen is read as `title`
// afterwards — taking a row is `controls.pointer-takes-a-menu-row`'s.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, fail } from "../assert";
import { STAGE_H, STAGE_W, TITLE_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  hoverMenuRow,
  type Harness,
} from "../harness";

/** One reported row, as much of it as this check reads. */
interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** How coarsely the stage is walked when looking for ground off the menu. */
const STEP = 8;

/** The row the pointer is moved onto: the second, which is not the posed one. */
const REACHED_ROW = TITLE_ITEMS.length - 1;

/** The row the screen is posed on, so the move has somewhere to move the highlight from. */
const POSED_ROW = 0;

/**
 * A point on the stage that no reported row covers.
 *
 * Found rather than fixed, because where a build draws its menu is the build's
 * own choice (`specs/screens.md`): a point written out here would sit inside some
 * conformant build's rows. The stage is walked on a coarse grid and the first
 * point outside every row is taken; a build whose rows genuinely covered the whole
 * stage has no such point, and the check says so rather than reading a row as
 * empty ground.
 */
function awayFromEveryRow(rows: readonly Rect[]): { x: number; y: number } {
  for (let y = STEP; y < STAGE_H; y += STEP) {
    for (let x = STEP; x < STAGE_W; x += STEP) {
      const inside = rows.some(
        (r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h,
      );
      if (!inside) return { x, y };
    }
  }
  fail(
    "a point on the stage that no reported menu row covers, so the pointer " +
      "can be moved off the menu (specs/screens.md)",
    `every point sampled every ${STEP} units fell inside one of ` +
      `${rows.length} reported rows`,
  );
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("highlights the row the pointer reaches, and takes nothing", async () => {
  h.debug.reset();
  h.debug.setScreen("title");
  h.debug.setMenuIndex(POSED_ROW);
  await h.advance(1);
  const posed = h.snapshot();
  assertEqual(posed.screen, "title", "the screen the move is made on");
  assertEqual(posed.menuIndex, POSED_ROW, "the row the move starts from");

  await hoverMenuRow(h, REACHED_ROW);
  captureStill(h, "highlighted");

  const reached = h.snapshot();
  assertEqual(
    reached.menuIndex,
    REACHED_ROW,
    "the highlighted row after the pointer moved into the rectangle the " +
      "build reported for it (specs/controls.md)",
  );
  assertEqual(
    reached.screen,
    "title",
    "the screen after the move: reaching a row takes it no further " +
      "(specs/controls.md)",
  );

  const away = awayFromEveryRow(reached.menu);
  h.point("move", away.x, away.y);
  await h.advance(1);
  const off = h.snapshot();
  assertEqual(
    off.menuIndex,
    REACHED_ROW,
    `the highlighted row after the pointer moved to (${away.x}, ` +
      `${away.y}), off every reported row, which specs/controls.md ` +
      `leaves on the row it last reached`,
  );
  assertEqual(
    off.screen,
    "title",
    "the screen after the move off: leaving a row takes nothing either",
  );
});
