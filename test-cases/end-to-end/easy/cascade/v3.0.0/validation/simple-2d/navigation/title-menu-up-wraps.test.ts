// navigation/title-menu-up-wraps — `menu-up` wraps from the first title item to the last.
//
// THE RULE. `specs/controls.md`, Menu navigation, the per-screen table:
// `title` / ``menu-up`` — "`menuIndex` moves up one, wrapping from `0` to the last item."
//
// THE WRAP IS ITS OWN POINT. A build that CLAMPS at the end of the list is a
// perfectly ordinary way to get a menu wrong, and it passes every other movement
// point on that menu: the selection still moves everywhere except off the end. So
// the one press this point drives is the one that has to come round, and the
// answer it must give is the far end of the list rather than the neighbour.
//
// ONE KEY, NOT BOTH. The pair `specs/controls.md` binds to `menu-up` is graded by
// `navigation/title-menu-up`, which drives both from a start in the middle of
// the list; what is left for this point is the boundary, and driving one key over
// it is what says the boundary is wrong rather than that the key is dead.
//
// THE STARTING SELECTION IS POSED with `setMenuIndex`
// (`specs/instrumentation.md`), never reached by pressing something else, so a
// check that walked to its start through the very action it grades cannot fail
// twice for one defect.
//
// THE LIST LENGTH IS READ FROM THE SPECIFICATION'S OWN CONSTANT, `TITLE_ITEMS`,
// so the figure this point compares against is the specification's rather than a
// literal repeated here.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { TITLE_ITEMS, MENU_UP_KEYS } from "../constants";
import {
  captureStill,
  createHarness,
  openTitle,
  pressKey,
  type Harness,
} from "../harness";

/** Where the selection starts, and where the wrap must leave it. */
const FROM = 0;
const TO = TITLE_ITEMS.length - 1;

/** The one key this point drives, of the pair `specs/controls.md` binds. */
const KEY = MENU_UP_KEYS[0];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("wraps from the first title item to the last", async () => {
  openTitle(h);
  h.debug.setMenuIndex(FROM);
  assertEqual(
    h.snapshot().menuIndex,
    FROM,
    "posing: menuIndex before the press — a selection that was never posed " +
      "leaves this point nothing to wrap",
  );

  await pressKey(h, KEY);
  const after = h.snapshot();

  await h.advance(1);
  // Before the assertions, so a menu that clamped still leaves the picture of
  // the selection it stopped on.
  captureStill(h, "menu");

  assertEqual(
    after.menuIndex,
    TO,
    `menuIndex after one press of ${KEY} on the title screen with ` +
      `menuIndex ${FROM}, over a menu of ${TITLE_ITEMS.length} items ` +
      `(specs/controls.md)`,
  );
  assertEqual(
    after.screen,
    "title",
    "the screen that press left, which a movement action does not change " +
      "(specs/controls.md)",
  );
});
