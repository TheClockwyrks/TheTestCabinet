// instrumentation/set-screen-almanac — `setScreen('almanac')` sets `screen` to
// almanac with menuIndex, almanacTab, and almanacScroll all 0.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md, `setScreen`: "Sets
// `screen` to `name`, one of the `Screen` values, with `menuIndex`,
// `almanacTab`, and `almanacScroll` all `0`", and "Applies on every screen".
// specs/ui.md (`title`): `THE ALMANAC` "Sets `screen = almanac`, with
// `menuIndex`, `almanacTab`, and `almanacScroll` all `0`".
//
// THE POSE, TWICE, so neither half of the reading can pass by accident. First
// from the busy night, a screen the call has to change. Then from the almanac
// itself with its two indices moved off 0 by real key edges, which is the only
// way the state carries a non-zero `almanacTab` or `almanacScroll` at all: the
// pose applies on every screen, so the call must put both back. The route is
// the surface alone; whether the title menu reaches the almanac is a screens
// point, and what the pose leaves standing is `set-screen-leaves-the-run`'s.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { ALMANAC_ENTRIES, ALMANAC_ROWS, ALMANAC_TABS } from "../constants";
import { captureStill, createHarness, tap, type Harness } from "../harness";
import { poseBusyNight } from "./helpers";

const TAB_STEP = "ArrowRight";
const ENTRY_STEP = "ArrowDown";

/**
 * The tab the disturbance settles on: the first past the first that holds more
 * entries than the list shows, so both indices can be off `0` at once.
 * `almanacTab` is moved by `right`, and `almanacScroll` only leaves `0` on a
 * tab of more than `ALMANAC_ROWS` entries (specs/ui.md, `almanac`).
 */
const SCROLLING_TAB = ALMANAC_TABS.findIndex(
  (tab, index) => index > 0 && ALMANAC_ENTRIES[tab].length > ALMANAC_ROWS,
);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("enters the almanac with the three indices at 0", async () => {
  poseBusyNight(h);
  await h.tick(1);

  h.debug.setScreen("almanac");
  const entered = h.snapshot();

  assertEqual(entered.screen, "almanac", "the screen");
  assertEqual(entered.menuIndex, 0, "menuIndex on arriving");
  assertEqual(entered.almanacTab, 0, "almanacTab on arriving");
  assertEqual(entered.almanacScroll, 0, "almanacScroll on arriving");

  // Disturb both indices, then take the row again: it is written "from any".
  for (let step = 0; step < SCROLLING_TAB; step += 1) await tap(h, TAB_STEP);
  for (let step = 0; step < ALMANAC_ROWS; step += 1) await tap(h, ENTRY_STEP);
  const disturbed = h.snapshot();
  assertEqual(
    disturbed.almanacTab,
    SCROLLING_TAB,
    "almanacTab before the call",
  );
  assertGreaterThan(disturbed.menuIndex, 0, "menuIndex before the call");
  assertGreaterThan(
    disturbed.almanacScroll,
    0,
    "almanacScroll before the call",
  );

  h.debug.setScreen("almanac");
  const again = h.snapshot();
  await h.tick(1);
  captureStill(h, "almanac");

  assertEqual(again.screen, "almanac", "the screen after the second call");
  assertEqual(again.menuIndex, 0, "menuIndex the call restores");
  assertEqual(again.almanacTab, 0, "almanacTab the call restores");
  assertEqual(again.almanacScroll, 0, "almanacScroll the call restores");
});
