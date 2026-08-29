// states/title — the title screen opens the game.
//
// `specs/ui.md` gives the title screen as "the title `FATHOM`, the tagline `HUNT
// IN THE DARK`, and the title menu", fixes the title menu's items as `DIVE` then
// `HOW TO PLAY` in that order, and states that "every build carries all seven"
// screens and "the game opens on `title`". Of the menus it states: "One item is
// selected at a time and the selected item is drawn distinctly from the others,
// so a player always sees which item `confirm` would take. The selection sits on
// the first item on arriving at a menu."
//
// So this point has three halves, and a build can pass any of them while failing
// another: the game OPENS on the title, the frame DRAWS the copy, and the
// selection is visible in what is drawn.
//
// THE SCREEN IS READ TWICE OVER. Once from `snapshot().screen` and once from the
// text the frame put on the canvas, so a build that reports a title it never
// draws, or draws one it never reports, fails here rather than passing on the
// half it got right.
//
// HOW "DRAWN DISTINCTLY" IS DECIDED. `specs/ui.md` fixes the requirement and not
// the presentation: brighter text, a marker beside the item, a panel behind it
// are all conforming, and asserting any one of them would fail a build that chose
// another. What every one of them has in common is the observable consequence —
// move the selection off the first item and the picture changes. So the check
// measures how much of the frame changed when the selection moved, against a
// baseline taken with the selection UNMOVED. A build that draws both items
// identically changes nothing and fails; a build whose title animates on its own
// still passes, because whatever the animation costs the baseline is charged for
// it too.
//
// WHAT THIS DOES NOT DECIDE. Where `DIVE` leads, which is `states/countdown`'s;
// where `HOW TO PLAY` leads, which is `states/howto`'s. Nothing here confirms
// anything.

import { afterEach, beforeEach } from "vitest";
import { TAGLINE_TEXT, TITLE_ITEMS, TITLE_TEXT } from "../../src/constants";
import { assertEqual, assertGreaterThanOrEqual } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { check } from "../scene";
import { MENU_DOWN_KEY, assertDrew, frameOps, opDiff } from "./screens";

/**
 * How much more of the frame must change when the selection moves than when it
 * does not, in operations.
 *
 * ONE operation. The bound is deliberately the smallest one that is not zero:
 * `specs/ui.md` asks that the selected item be "drawn distinctly from the
 * others" and fixes nothing about how much of the picture that costs, so
 * anything larger would be a figure this suite invented. What it rules out is
 * exactly what the requirement rules out — a menu whose two items are drawn the
 * same, which changes the picture by nothing at all when the selection moves.
 */
const SELECTION_CHANGE_MIN = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

check(
  "opens on the title, draws its copy, and shows which item is selected",
  async () => {
    h.debug.reset();
    const opened = h.snapshot();

    // The title as the game opens it, with the selection on the first item.
    const selected = await frameOps(h);
    // Before the assertions, so a failing check still leaves the picture that
    // shows why the reviewer is being told the title is wrong.
    captureStill(h, "title");

    // The same screen again, nothing pressed: what one frame of this screen costs
    // the next all by itself.
    const unmoved = await frameOps(h);
    // And the same screen with the selection moved off the first item.
    await h.tap(MENU_DOWN_KEY);
    const moved = await frameOps(h);

    assertEqual(
      opened.screen,
      "title",
      "the screen a fresh game opens on (specs/ui.md)",
    );

    assertDrew(
      selected,
      TITLE_TEXT,
      "the title the title screen shows (specs/ui.md)",
    );
    assertDrew(
      selected,
      TAGLINE_TEXT,
      "the tagline the title screen shows (specs/ui.md)",
    );
    for (const item of TITLE_ITEMS) {
      assertDrew(
        selected,
        item,
        `an item of the title menu, which is ${TITLE_ITEMS.join(" then ")} (specs/ui.md)`,
      );
    }

    const idle = opDiff(selected, unmoved);
    assertGreaterThanOrEqual(
      opDiff(selected, moved),
      idle + SELECTION_CHANGE_MIN,
      `operations of the title frame that changed when the selection moved off ` +
        `${TITLE_ITEMS[0]}, against the ${String(idle)} that changed when it did ` +
        `not — the selected item is drawn distinctly from the others (specs/ui.md)`,
    );
  },
);
