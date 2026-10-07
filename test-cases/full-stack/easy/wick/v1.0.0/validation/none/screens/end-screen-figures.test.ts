// screens/end-screen-figures — the end screen reports the run that just ended,
// in the snapshot and on the frame.
//
// WHERE THE THRESHOLD COMES FROM. specs/state.md: "The `fallen` and `dawn`
// screens keep the run that just ended, since they report its time, level, and
// kills." specs/ui.md ("`fallen` and `dawn`"), the table: "Time survived | The
// run clock at the end, as `m:ss`", "Level | The level reached", "Kills | The
// kill count." The clock's format is specs/ui.md's own, "as `m:ss`, counting up
// from `0:00` in whole seconds, the seconds always two digits", so a run ended
// on tick `7260` reads `121` whole seconds and shows `2:01`.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night posed to one particular
// run — the clock one tick short of `7260`, level `6`, `143` kills — and then
// ended fallen by `setHp(0)` and the tick that applies it, which is the ending
// specs/world.md states. The figures are chosen so that none of the three is a
// digit of another and none is a fresh run's: a build that reported the idle
// run, or the clock in seconds, or the level where the kills belong, fails on
// one of them. Every driver switch is off, so nothing kills anything into the
// count and nothing else moves a figure between the pose and the ending tick.
//
// THE TOLERANCE. None on the snapshot: a tick, a level and a count are exact.
// On the frame the clock is matched ignoring case and whitespace, across the
// runs of text the frame drew (the shared harness's `drewTextAnywhere`), and
// the two counts as whole numbers standing alone, because specs/ui.md fixes
// the figures and not the words around them.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { clockText } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { assertNames, assertShows, endFallen, night, shown } from "./stage";

/** The run this ends: the clock it ends on, the level reached, the kills counted. */
const ENDED = { tick: 7260, level: 6, kills: 143 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reads tick 7260, level 6 and 143 kills, and draws 2:01, 6 and 143", async () => {
  await night(h);
  await h.debug.setTick(ENDED.tick - 1);
  await h.debug.setLevel(ENDED.level);
  await h.debug.setKills(ENDED.kills);

  const ended = await endFallen(h);
  const page = await shown(h);
  await captureStill(h, "figures");

  assertEqual(
    ended.run.tick,
    ENDED.tick,
    "the run clock the end screen reports",
  );
  assertEqual(ended.run.level, ENDED.level, "the level the end screen reports");
  assertEqual(ended.run.kills, ENDED.kills, "the kills the end screen reports");
  assertShows(page, clockText(ENDED.tick), "the end screen's time survived");
  assertNames(page, String(ENDED.level), "the end screen's level");
  assertNames(page, String(ENDED.kills), "the end screen's kill count");
});
