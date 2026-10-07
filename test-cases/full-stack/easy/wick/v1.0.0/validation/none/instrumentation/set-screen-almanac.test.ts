// Wick — instrumentation/set-screen-almanac: `setScreen("almanac")` from
// `playing` stands the game on `almanac` with `menuIndex`, `almanacTab` and
// `almanacScroll` all `0`.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md — `setScreen(name)`):
// "Sets `screen` to `name`, one of the `Screen` values, with `menuIndex`,
// `almanacTab`, and `almanacScroll` all `0`", and "Applies on every screen".
//
// WHY THE WORLD IS POSED AS IT IS. The almanac is opened and driven off all
// three of its opening indices first — two tabs across, then `ALMANAC_ROWS`
// entries down the enemies tab, which is one past its last visible row — and
// only then is the game stood on `playing`, so a build that carried either
// index through `playing` reaches this call holding it, and the `0` the
// sentence promises is the call's rather than a figure that was already `0`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotEqual } from "../assert";
import { ALMANAC_ROWS } from "../constants";
import {
  captureStill,
  createHarness,
  poseScreen,
  pressAction,
  pressDown,
  type Harness,
} from "../harness";

/** The tab the almanac is driven to before the call: `ENEMIES`, the third. */
const POSED_TAB = 2;

/** Entry moves down the tab, one past the last visible row, so the list scrolls. */
const POSED_MOVES = ALMANAC_ROWS;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("stands the game on the almanac with the three indices at 0", async () => {
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

  const playing = await poseScreen(h, "playing");
  assertEqual(playing.screen, "playing", "the screen the call is made from");

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
});
