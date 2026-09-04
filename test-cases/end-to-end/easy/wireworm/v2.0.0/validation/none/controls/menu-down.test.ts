// Wireworm — controls/menu-down: the `down` action moves a menu highlight on by
// one, through both of the keys it is bound to.
//
// specs/controls.md gives `down` two jobs — it "moves the cursor down inside the
// band during play, and moves a menu highlight down" — and this is the menu job;
// the play job is `controls.down-arrow` and `controls.key-s`. The rule it holds a
// build to is the one under Menus: "Every menu is vertical and is driven by `up`,
// `down`, and `confirm`. `up` and `down` move the highlight by one item".
//
// BOTH BOUND KEYS, ONE POINT. The requirement is the ACTION, and
// specs/controls.md binds it to `ArrowDown` and `KeyS` together, so a build whose
// menus answer only the arrow has not implemented `down` — it has implemented one
// of its keys. Reading both here is one requirement exercised through each of its
// two doors, not two requirements: the two keys are posed identically and read
// identically, and the failure names which door did not open.
//
// THE HIGHLIGHT IS READ, NOT THE PICTURE. Which item is drawn distinctly is
// `screens.title-screen`'s reading; `menuIndex` is what specs/instrumentation.md
// reports and what this point moves.
//
// POSED ON THE FIRST ITEM, so the move under test lands on the second and never
// reaches the wrap. The title menu holds `TITLE_ITEMS` (`DESCEND`, `HOW TO PLAY`),
// two items, so `0` is the only starting index from which moving down is a plain
// step; that a move DOWN from the last item comes back to the first is
// `screens.title-menu-wraps-down`'s requirement and nothing here exercises it.
//
// THE WORLD IS THE TITLE MENU AND ITS INDEX. Nothing else is posed and nothing
// else is touched: the two operations used are the screen and the highlight the
// requirement is about.

import { afterEach, beforeEach, it } from "vitest";
import { TITLE_ITEMS } from "../constants";
import { assertEqual } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";

/** The two keys specs/controls.md binds the `down` action to. */
const KEYS = ["ArrowDown", "KeyS"] as const;

/**
 * The item each press starts from: the first, `DESCEND`.
 *
 * The step under test therefore lands on `HOW TO PLAY`, the last of the
 * `TITLE_ITEMS`, and the wrap is never reached.
 */
const FROM_INDEX = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("moves the title menu's highlight on by one for each key bound to down", async () => {
  await h.debug.setScreen("title");

  for (const key of KEYS) {
    await h.debug.setMenuIndex(FROM_INDEX);
    await h.advance(1);

    await h.tap(key);
    await h.advance(1);
    const after = await h.snapshot();
    await captureStill(h, "selection");

    assertEqual(
      after.menuIndex,
      FROM_INDEX + 1,
      `${key}: the highlighted item after one press, posed on item ${FROM_INDEX} of ${TITLE_ITEMS.length}`,
    );
  }
});
