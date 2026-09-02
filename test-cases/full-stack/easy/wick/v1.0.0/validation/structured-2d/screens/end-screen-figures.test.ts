// Wick — screens/end-screen-figures: the end screen reports the run that just
// ended, not a fresh or an idle one.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/instrumentation.md`,
// Snapshot shape: "`run` reports the idle run of `specs/state.md` on `title`,
// `howto`, and `almanac`, and the run that just ended on `fallen` and
// `dawn`."
// `specs/state.md`, "The idle run": "The `fallen` and `dawn` screens keep the
// run that just ended, since they report its time, level, and kills."
// `specs/ui.md`, "`fallen` and `dawn`", draws those three: "The run clock at
// the end, as `m:ss`", "The level reached", and "The kill count".
//
// WHAT IS READ. Both halves of that sentence: the snapshot's `run` on the end
// screen, and the frame drawn over it. `END_TICK` (`7260`) is `2:01` on the
// clock, a figure whose minutes and seconds are both non-zero and whose digits
// cannot be confused with the level or the kill count.
//
// THE DRIVE. An isolated `playing` run with every driver switch off, so no
// spawn, hit, or drop moves a figure while the scenario is posed; the clock
// posed one tick short of `END_TICK`, the level and the kill count posed,
// `hp` posed to `0`, and the one tick that ends the run through the ending
// rule of `specs/world.md`.
//
// THE TOLERANCE. The snapshot's figures are exact; the clock is exact as a
// substring of drawn text, and the level and kill count as whole tokens.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertTrue } from "../assert";
import { clockText } from "../constants";
import {
  advanceTicks,
  captureStill,
  createHarness,
  drawnText,
  drewText,
  hasToken,
  isolate,
  type Harness,
} from "../harness";

/** The run that ends: its clock, its level, its kills. */
const END_TICK = 7260;
const LEVEL = 6;
const KILLS = 143;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("reads and draws the ended run's clock, level, and kills", async () => {
  isolate(h);
  h.debug.setTick(END_TICK - 1);
  h.debug.setLevel(LEVEL);
  h.debug.setKills(KILLS);
  h.debug.setHp(0);

  const ended = await advanceTicks(h, 1);
  const { calls } = await h.frameDraw();
  captureStill(h, "figures");

  assertEqual(ended.screen, "fallen", "the screen the ending tick left");
  assertEqual(ended.run.tick, END_TICK, "run.tick on the end screen");
  assertEqual(ended.run.level, LEVEL, "run.level on the end screen");
  assertEqual(ended.run.kills, KILLS, "run.kills on the end screen");

  const lines = drawnText(calls);
  assertTrue(
    drewText(calls, clockText(END_TICK)),
    `the end screen drew the time survived, ${clockText(END_TICK)}`,
  );
  assertTrue(
    hasToken(lines, String(LEVEL)),
    `the end screen drew the level, ${LEVEL}`,
  );
  assertTrue(
    hasToken(lines, String(KILLS)),
    `the end screen drew the kills, ${KILLS}`,
  );
});
