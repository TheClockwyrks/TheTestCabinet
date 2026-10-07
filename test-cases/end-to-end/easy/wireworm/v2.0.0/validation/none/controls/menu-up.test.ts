// Wireworm — controls/menu-up: the `up` action moves a menu highlight back by one,
// through both of the keys it is bound to.
//
// specs/controls.md gives `up` two jobs — it "moves the cursor up inside the band
// during play, and moves a menu highlight up" — and this is the menu job; the play
// job is `controls.up-arrow` and `controls.key-w`. The rule it holds a build to is
// the one under Menus: "Every menu is vertical and is driven by `up`, `down`, and
// `confirm`. `up` and `down` move the highlight by one item".
//
// BOTH BOUND KEYS, ONE POINT. The requirement is the ACTION, and
// specs/controls.md binds it to `ArrowUp` and `KeyW` together, so a build whose
// menus answer only the arrow has not implemented `up` — it has implemented one of
// its keys. Reading both here is one requirement exercised through each of its two
// doors: the two keys are posed identically and read identically, and the failure
// names which door did not open.
//
// THE MIRROR OF `controls.menu-down`, and a separate point because a build can be
// right about one direction and wrong about the other — a menu that steps forward
// on both keys grades differently here than there.
//
// POSED ON THE LAST ITEM, so the move under test lands on the first and never
// reaches the wrap. The title menu holds `TITLE_ITEMS` (`DESCEND`, `HOW TO PLAY`),
// two items, so index `1` is the only starting index from which moving up is a
// plain step; that a move UP from the first item goes round to the last is
// `screens.title-menu-wraps-up`'s requirement and nothing here exercises it.
//
// THE WORLD IS THE TITLE MENU AND ITS INDEX. Nothing else is posed and nothing
// else is touched.

import { afterEach, beforeEach, it } from "vitest";
import { TITLE_ITEMS } from "../constants";
import { assertEqual } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";

/** The two keys specs/controls.md binds the `up` action to. */
const KEYS = ["ArrowUp", "KeyW"] as const;

/**
 * The item each press starts from: the last of the `TITLE_ITEMS`.
 *
 * The step under test therefore lands on `DESCEND`, the first item, and the wrap
 * is never reached.
 */
const FROM_INDEX = TITLE_ITEMS.length - 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("moves the title menu's highlight back by one for each key bound to up", async () => {
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
      FROM_INDEX - 1,
      `${key}: the highlighted item after one press, posed on item ${FROM_INDEX} of ${TITLE_ITEMS.length}`,
    );
  }
});
