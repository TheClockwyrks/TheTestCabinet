// instrumentation/set-screen-almanac — `setScreen('almanac')` from playing
// enters the almanac with the idle run and menuIndex, almanacTab, and
// almanacScroll all 0, exactly as confirming THE ALMANAC does.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md, `setScreen`'s row for
// `almanac`: from "any", "Enters the almanac exactly as confirming
// `THE ALMANAC` does: the idle run, `menuIndex` `0`, `almanacTab` `0`,
// `almanacScroll` `0`". specs/ui.md (`title`): `THE ALMANAC` "Sets
// `screen = almanac`, with `menuIndex`, `almanacTab`, and `almanacScroll` all
// `0`". The idle run is the table under specs/state.md, "The idle run",
// restated as `IDLE_RUN`.
//
// THE POSE, TWICE, so neither half of the row can pass by accident. First from
// the busy night, where "the idle run" is read against a run whose every region
// would betray a call that merely flipped the screen field. Then from the
// almanac itself with its two indices moved off 0 by real key edges, which is
// the only way the state carries a non-zero `almanacTab` or `almanacScroll` at
// all: the row is "from any", so the call must put both back. The route is the
// surface alone; whether the title menu reaches the almanac is a screens point.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { ALMANAC_ENTRIES, ALMANAC_ROWS, ALMANAC_TABS } from "../constants";
import { captureStill, createHarness, tap, type Harness } from "../harness";
import { assertIdleRun, poseBusyNight } from "./helpers";

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

it("enters the almanac with the idle run and the three indices at 0", async () => {
  poseBusyNight(h);
  await h.tick(1);

  h.debug.setScreen("almanac");
  const entered = h.snapshot();

  assertEqual(entered.screen, "almanac", "the screen");
  assertEqual(entered.menuIndex, 0, "menuIndex on arriving");
  assertEqual(entered.almanacTab, 0, "almanacTab on arriving");
  assertEqual(entered.almanacScroll, 0, "almanacScroll on arriving");
  assertIdleRun(entered.run, "run on the almanac: the idle run");

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
  assertIdleRun(again.run, "run after the second call: the idle run");
});
