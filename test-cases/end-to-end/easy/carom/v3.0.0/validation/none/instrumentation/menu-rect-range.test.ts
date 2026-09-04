// instrumentation/menu-rect-range — menuItemRect reports no region past a
// menu's last item.
//
// specs/instrumentation.md: `menuItemRect` returns `null` "when `index` names no
// item of that menu". This is the edge case where the menu IS on screen and the
// index is the one thing wrong, which is a different fault from a screen that
// shows no menu at all — that is `instrumentation/menu-rect-null`'s point, and a
// build can get one right and the other wrong.
//
// The operation is called DIRECTLY here rather than through the harness's
// `menuRect`, which asserts a region came back: this is the check that is ABOUT
// the reading answering nothing, so the shared helper is exactly the wrong tool.
//
// THE POSITIVE HALF IS NOT READ HERE. That `menuItemRect` answers on a menu at
// all is `instrumentation/debug-api`'s point, and that the region it reports is
// the one the build drew is the `pointer` and `touch` categories'. A build that
// answered `null` everywhere would pass this and fail all of those, which is what
// says which fault it has.
//
// A build that hands back a region where there is none sends a pointer driver at
// a rectangle no item occupies, which costs a driver its certainty and a player
// nothing — the reason this reads state alone and captures the menu it asked
// about.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertNull } from "../assert";
import { TITLE_ITEMS } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("answers null past the end of the menu on screen", async () => {
  await h.debug.reset();
  assertGreaterThan(TITLE_ITEMS.length, 0);
  assertEqual((await h.snapshot()).screen, "title");
  await captureStill(h, "menu");
  assertNull(
    await h.debug.menuItemRect(TITLE_ITEMS.length),
    "menuItemRect must answer null for an index the title menu has no item at",
  );
});
