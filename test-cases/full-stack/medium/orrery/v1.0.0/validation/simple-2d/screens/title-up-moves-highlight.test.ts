// screens/title-up-moves-highlight — one `up` press moves the title highlight up
// one item.
//
// THE RULE, `specs/ui.md`, Screens, `title`: "`up` and `down` move the highlight
// by one item and wrap at both ends." `specs/controls.md` says which key that is
// and that the title reads it: `up` is `ArrowUp`, "read as a press edge, once per
// press", and the title's row of What each screen reads is "`up` and `down` move
// the highlight; `confirm` takes it; `mute`."
//
// THE CONFIGURATION is the title with the highlight posed onto the LAST entry of
// `TITLE_ITEMS`, and ONE press of `up`. Starting at the bottom keeps the step
// away from the wrap at the top, which is `title-up-wraps`'s point: from the last
// entry an `up` press has an item above it to reach.
//
// WHY THE HIGHLIGHT IS POSED RATHER THAN WALKED THERE. `setMenuIndex` "Sets the
// highlighted item of the menu the current screen shows"
// (`specs/instrumentation.md`), which reaches the start of this scenario without
// leaning on the `down` action, whose own point is `title-down-moves-highlight`.
//
// THE VERDICT. `menuIndex` is one less than the last entry's index and the game
// is still on the title.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { TITLE_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  openTitle,
  pressAction,
  type Harness,
} from "../harness";

/** The last entry of the title menu, where the press starts. */
const LAST = TITLE_ITEMS.length - 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("moves the highlight from the last item to the one above it", async () => {
  assertGreaterThan(
    TITLE_ITEMS.length,
    1,
    "TITLE_ITEMS carries more than one entry, so there is an item above the last",
  );

  await openTitle(h);
  await h.debug.setMenuIndex(LAST);
  await h.advance(1);

  const before = await h.snapshot();
  assertEqual(
    before.screen,
    "title",
    "the press this point reads is delivered on the title screen",
  );
  assertEqual(
    before.menuIndex,
    LAST,
    `the highlight stands on the last entry of TITLE_ITEMS (${TITLE_ITEMS[LAST]}) ` +
      "before the press",
  );

  const after = await pressAction(h, "up");
  await captureStill(h, "moved");

  assertEqual(
    after.screen,
    "title",
    "an up press moves the highlight rather than leaving the screen",
  );
  assertEqual(
    after.menuIndex,
    LAST - 1,
    `one up press moves the highlight one item, from ${TITLE_ITEMS[LAST]} to ` +
      `${TITLE_ITEMS[LAST - 1]}`,
  );
});
