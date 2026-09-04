// Wick — instrumentation/set-screen-almanac: `setScreen("almanac")` from
// `playing` enters `almanac` with the idle run and `menuIndex`, `almanacTab`
// and `almanacScroll` all `0`.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md — `setScreen(name)`):
// the `almanac` row, "any | Enters the almanac exactly as confirming
// `THE ALMANAC` does: the idle run, `menuIndex` `0`, `almanacTab` `0`,
// `almanacScroll` `0`", under "Enters screen `name` ... exactly as the real
// transition into it from the current screen enters it". specs/ui.md, the title
// menu: "`THE ALMANAC` | Sets `screen = almanac`, with `menuIndex`,
// `almanacTab`, and `almanacScroll` all `0`", and, of the almanac itself, "The
// almanac holds the idle run". The idle run is specs/state.md's list, restated
// by `idleRun()`, and the comparison is exact: the row discards a run, it does
// not approximate one.
//
// WHY THE WORLD IS POSED AS IT IS. The almanac is opened and driven off its
// opening indices first — two tabs across, then ten entries down the enemies
// tab, which is one past its last visible row — and only then is the run begun,
// so a build that carried either index through
// `playing` reaches this call holding it, and the `0` the row promises is the
// call's rather than a figure that was already `0`. The run the call discards is
// given a clock, an enemy and a wounded lamplighter for the same reason.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertNotEqual } from "../assert";
import { ALMANAC_ROWS } from "../constants";
import {
  captureStill,
  createHarness,
  documentedRun,
  idleRun,
  placeEnemy,
  poseScreen,
  pressAction,
  pressDown,
  type Harness,
} from "../harness";

/** The tab the almanac is driven to before the run begins: `ENEMIES`, the third. */
const POSED_TAB = 2;

/** Entry moves down the tab, one past the last visible row, so the list scrolls. */
const POSED_MOVES = ALMANAC_ROWS;

/** A clock the run carries, so the idle run after the call is a discard. */
const POSED_TICK = 300;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("enters the almanac with the idle run and the three indices at 0", async () => {
  // The almanac, driven off every one of its opening indices.
  await poseScreen(h, "almanac");
  for (let move = 0; move < POSED_TAB; move += 1) await pressAction(h, "right");
  for (let move = 0; move < POSED_MOVES; move += 1) await pressDown(h);
  const driven = await h.snapshot();
  assertEqual(
    driven.almanacTab,
    POSED_TAB,
    "the tab the almanac was driven to",
  );
  assertNotEqual(driven.menuIndex, 0, "the entry the almanac was driven to");
  assertNotEqual(
    driven.almanacScroll,
    0,
    "the row the almanac's list was scrolled to",
  );

  // The run the call discards, begun from there and given something to lose.
  await h.debug.setScreen("playing");
  await h.debug.setTick(POSED_TICK);
  await placeEnemy(h, "moth", 200, 0);
  await h.debug.setHp(40);

  const almanac = await poseScreen(h, "almanac");
  await captureStill(h, "almanac");

  assertEqual(
    almanac.screen,
    "almanac",
    "the screen after setScreen('almanac')",
  );
  assertEqual(almanac.menuIndex, 0, "menuIndex on entering almanac");
  assertEqual(almanac.almanacTab, 0, "almanacTab on entering almanac");
  assertEqual(almanac.almanacScroll, 0, "almanacScroll on entering almanac");
  assertDeepEqual(
    documentedRun(almanac.run),
    idleRun(),
    "the run the almanac holds",
  );
});
