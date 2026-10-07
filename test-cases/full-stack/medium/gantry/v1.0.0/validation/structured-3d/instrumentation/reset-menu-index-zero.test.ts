// instrumentation/reset-menu-index-zero — a reset puts the menu highlight back to
// 0, the title screen's first entry.
//
// `specs/instrumentation.md` § The run and the screens: "`reset` restores every
// field the snapshot reports to its title-screen value, bar one: the `title`
// screen with `menuIndex` `0`, …". The snapshot reports the highlight as
// `menuIndex`, counted from `0` (`specs/state.md`).
//
// THE HIGHLIGHT IS MOVED OFF `0` FIRST, through the pose that exists for it:
// "`setMenuIndex(index)` sets the highlighted entry of the menu on the screen
// showing, counted from `0`; the domain is the entry count of the menu that
// screen shows". The title screen's menu is `TITLE_ITEMS`, two entries
// (`specs/ui.md`), so `1` is inside the domain and is the only other entry there
// is. The check stands on the title screen because that is where `setMenuIndex`
// applies and where the reset is going to leave the game anyway, so the highlight
// read afterwards is a highlight the title menu actually shows.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { TITLE_ITEMS } from "../constants";
import { createHarness, type Harness } from "../harness";

/** The last entry of the title menu: off `0`, and inside the domain. */
const POSED = TITLE_ITEMS.length - 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("puts the menu highlight back to 0", async () => {
  assertEqual(
    (await h.snapshot()).screen,
    "title",
    "the screen the highlight is posed on, where setMenuIndex applies",
  );
  await h.debug.setMenuIndex(POSED);
  assertEqual(
    (await h.snapshot()).menuIndex,
    POSED,
    `the highlight setMenuIndex(${POSED}) posed, before the reset`,
  );

  await h.debug.reset();
  const menuIndex = (await h.snapshot()).menuIndex;
  await h.advance(1);
  await h.capture("menu", "The title menu's highlight after a reset");

  assertEqual(
    menuIndex,
    0,
    "menuIndex after a reset (specs/instrumentation.md)",
  );
});
