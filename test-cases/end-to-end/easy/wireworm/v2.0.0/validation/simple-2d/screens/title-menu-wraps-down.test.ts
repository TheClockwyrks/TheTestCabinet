// Wireworm — screens/title-menu-wraps-down: `down` on the title's last item
// wraps the highlight to the first.
//
// One rule of the menu state machine `specs/controls.md` fixes: "`up` and `down`
// move the highlight by one item and wrap at both ends, so moving down from the
// last item highlights the first".
//
// The last item is POSED with the surface's own `setMenuIndex` rather than
// walked to with presses of the same key under test. A build whose `down` steps
// nowhere would otherwise sit on item 0 and read as a wrap that never happened,
// and posing the edge is what makes the one press this check makes the only
// thing that can decide it.
//
// The press is the `down` action's own bound key, dispatched as a real key event
// at the target the engine listens on — the menus are keyboard only
// (`specs/controls.md`).

import { afterEach, beforeEach, it } from "vitest";
import { TITLE_ITEMS } from "../constants";
import { assertEqual } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";

/** `down`'s own bound key (specs/controls.md). */
const DOWN_KEY = "ArrowDown";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("wraps the title highlight from the last item to the first", async () => {
  h.debug.reset();
  const last = TITLE_ITEMS.length - 1;
  h.debug.setMenuIndex(last);
  const posed = h.snapshot();
  assertEqual(posed.screen, "title", "the press is made on the title screen");
  assertEqual(
    posed.menuIndex,
    last,
    "setMenuIndex rests the highlight on the last title item " +
      "(specs/instrumentation.md)",
  );

  await h.tap(DOWN_KEY);
  captureStill(h, "wrapped");

  const wrapped = h.snapshot();
  assertEqual(wrapped.screen, "title", "the wrap leaves the game on the title");
  assertEqual(
    wrapped.menuIndex,
    0,
    "one down press past the last item highlights the first " +
      "(specs/controls.md)",
  );
});
