// pointer/almanac-wheel-scrolls — one row of wheel travel moves the almanac's
// list down one row.
//
// WHERE THE THRESHOLD COMES FROM. specs/controls.md ("The pointer"), rule 3:
// "The wheel. On `almanac`, wheel travel moves the list. A frame's travel is
// that frame's wheel deltas summed in stage units, divided by `WHEEL_ROW`
// (`100`) and truncated toward zero to give the number of rows `almanacScroll`
// moves, downward travel moving it toward the end of the list". specs/ui.md
// ("`almanac`") gives the `TOOLS` tab "the ten of `BASE_WEAPON_IDS`, then the
// six of `EVOLUTION_IDS`", sixteen entries, so `max(0, count − ALMANAC_ROWS)` is
// `6` and one row of travel is well inside it. specs/ui.md ("`almanac`") has
// `almanacScroll` `0` on arriving, so the list starts at its first row.
//
// WHAT IS READ, AND WHY IT DECIDES THE CLAIM. `almanacScroll` off the snapshot
// the wheeling frame left. It is the specification's own name for "the almanac
// list's first visible row", so what the list is showing is decided by a number
// rather than by where a build drew its rows.
//
// HOW THE SCENARIO IS DRIVEN. The almanac is entered through
// `setScreen("almanac")`, which specs/instrumentation.md defines as setting
// `screen` alone, "with `menuIndex`, `almanacTab`, and `almanacScroll`
// all `0`". The wheel is Chromium's own, turned by exactly
// `WHEEL_ROW` (`100`) stage units of downward travel taken into the page's CSS
// pixels through the harness's fit, which is the same conversion the build
// applies to `deltaY` inverted. The pointer is rested on a point inside none of
// the screen's rectangles first, so a build that listens for the wheel on its
// canvas is served and the hover rule moves nothing while the wheel turns.
// Exactly one frame runs after the turn, because the pointer rules are "applied
// on every frame".
//
// THE TOLERANCE. None: `almanacScroll` is a whole number of rows and the travel
// is exactly one row's worth.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { captureStill, createHarness, wheelBy, type Harness } from "../harness";
import { poseAlmanac } from "./stage";

/** The travel the wheel is turned by, in rows: one `WHEEL_ROW` of downward travel. */
const TURNED = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reads almanacScroll 1 after one row of downward wheel travel", async () => {
  await poseAlmanac(h);

  const scrolled = await wheelBy(h, TURNED);
  await captureStill(h, "scrolled");

  assertEqual(scrolled.screen, "almanac", "the screen the wheel turned on");
  assertEqual(
    scrolled.almanacScroll,
    TURNED,
    "almanacScroll after one row of downward wheel travel",
  );
});
