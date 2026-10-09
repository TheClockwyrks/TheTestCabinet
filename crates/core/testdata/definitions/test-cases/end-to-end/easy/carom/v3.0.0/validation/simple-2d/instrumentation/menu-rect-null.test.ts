// instrumentation/menu-rect-null — menuItemRect reports no region on a screen
// with no menu.
//
// specs/instrumentation.md: `menuItemRect` returns `null` on `countdown` and on
// `playing`, which show no menu. The two are the SAME edge case read twice and
// exercised the same way, so they share this validator. An index past the end of
// a menu that IS on screen is a different edge case and a different point,
// `instrumentation/menu-rect-range`.
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
// nothing — the reason this reads state alone and captures the screen it asked
// about.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNull } from "../assert";
import {
  captureStill,
  createHarness,
  enterPlaying,
  openCountdown,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("answers null on the countdown and in live play", async () => {
  // The countdown shows no menu.
  openCountdown(h, "versus");
  await h.advance(1);
  assertEqual(h.snapshot().screen, "countdown");
  assertNull(
    h.debug.menuItemRect(0),
    "menuItemRect must answer null on the countdown, which shows no menu",
  );

  // Neither does live play.
  enterPlaying(h, "versus");
  await h.advance(1);
  assertEqual(h.snapshot().screen, "playing");
  captureStill(h, "live");
  assertNull(
    h.debug.menuItemRect(0),
    "menuItemRect must answer null on playing, which shows no menu",
  );
});
