// navigation/hud-menu-down — `menu-down` moves the HUD selection down one.
//
// THE RULE. `specs/controls.md`, Menu navigation: "The controls a screen carries
// are that screen's menu, in the order the table above gives them. `menuIndex` is
// the selected item on that menu, counted from `0` for the first." Its per-screen
// table gives `playing` / ``menu-down``: "`menuIndex` moves down one over `HUD_ITEMS`, wrapping from the last item to `0`."
//
// ONE ACTION, ONE POINT, ONE DIRECTION. A build with a working `menu-down` and a
// dead `menu-up` must grade differently from one with both dead, so each action
// on each menu is its own point. The wrap is its own point again, because a build
// that clamps at the end of the list is a different build from one that never
// moves at all.
//
// A KEY BOUND TO TWO CODES IS ONE POINT. `specs/controls.md` binds ``menu-down`` to
// `ArrowDown` and `KeyS`: the two raise the same action and exercise the same rule the same
// way, so both are driven here from the same posed start and a build that bound
// only one of the pair fails.
//
// THE STARTING SELECTION IS POSED, never reached by pressing something else: a
// check that walked to its start through the very action it grades would fail
// twice for one defect and say less about which. `setMenuIndex`
// (`specs/instrumentation.md`) puts it there, and
// `instrumentation/menu-index-reads-back` is the point that grades the pose.
//
// THE SCREEN IS READ AS WELL AS THE SELECTION, because a build that treated a
// movement key as a confirm would move the selection and leave the screen — and
// would otherwise pass a check that read the index alone.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { MENU_DOWN_KEYS } from "../constants";
import {
  captureStill,
  createHarness,
  openTable,
  pressKey,
  type Harness,
} from "../harness";

/** Where the selection starts, and where the action must leave it. */
const FROM = 0;
const TO = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("moves the HUD selection down on either down key", async () => {
  const read: { code: string; index: number; screen: string }[] = [];
  for (const code of MENU_DOWN_KEYS) {
    // Each key is driven from the same posed start, so the second reading is not
    // of a selection the first one left.
    openTable(h);
    h.debug.setMenuIndex(FROM);
    assertEqual(
      h.snapshot().menuIndex,
      FROM,
      `posing: menuIndex before the press of ${code} — a selection that was ` +
        `never posed leaves this point nothing to move`,
    );

    await pressKey(h, code);
    const after = h.snapshot();
    read.push({ code, index: after.menuIndex, screen: after.screen });
  }

  await h.advance(1);
  // Before the assertions, so a key read the wrong way still leaves the picture
  // of the menu it left.
  captureStill(h, "hud");

  for (const step of read) {
    assertEqual(
      step.index,
      TO,
      `menuIndex after one press of ${step.code} on the playing screen with ` +
        `menuIndex ${FROM} (specs/controls.md)`,
    );
    assertEqual(
      step.screen,
      "playing",
      `the screen that press left, which menu-down does not change ` +
        `(specs/controls.md)`,
    );
  }
});
