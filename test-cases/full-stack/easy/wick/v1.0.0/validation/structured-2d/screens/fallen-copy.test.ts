// Wick — screens/fallen-copy: the fallen screen draws its heading, the run's
// three figures, and its two menu items in order.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/ui.md`, "`fallen` and
// `dawn`": "`fallen` shows `FALLEN_TEXT` (`THE LIGHT WENT OUT`) ...; each
// shows the run's figures and the same menu below them", and the table gives
// Time survived as "The run clock at the end, as `m:ss`", Level as "The level
// reached", Kills as "The kill count", and Menu as "`END_ITEMS`: `TRY AGAIN`,
// `TITLE`, in that order". `specs/world.md`, "Fallen and dawn", ends a run
// fallen on the tick `hp` is "`0` or below".
//
// WHAT IS READ, AND WHY. The heading and the two menu items as drawn copy, the
// three figures as whole tokens among the runs of text the frame drew — so a
// build that writes `LEVEL 7` and one that writes `Level: 7` both read as
// having shown the level — and the two items' anchors, which must descend in
// the order `END_ITEMS` lists. What the figures ARE for a given run is
// `screens/end-screen-figures`; here they are chosen to be unmistakable in a
// token search.
//
// THE DRIVE. An isolated `playing` run with every driver switch off, the clock
// posed one tick short of `END_TICK` so the ending tick lands exactly on it,
// the level and the kill count posed, `hp` posed to `0`, and the one tick that
// ends the run through the ending rule.
//
// THE TOLERANCE. The copy and the clock are exact as substrings; the level and
// the kill count are exact as whole tokens. The order is strict.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertLessThan,
  assertNotNull,
  assertTrue,
} from "../assert";
import { END_ITEMS, FALLEN_TEXT, clockText } from "../constants";
import {
  advanceTicks,
  captureStill,
  createHarness,
  drawnText,
  drewText,
  hasToken,
  isolate,
  textDraws,
  type Harness,
} from "../harness";
import { anchorY } from "./stage";

/** The run the fallen screen reports: its clock, its level, its kills. */
const END_TICK = 4500;
const LEVEL = 7;
const KILLS = 253;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("draws THE LIGHT WENT OUT, the figures, and TRY AGAIN above TITLE", async () => {
  isolate(h);
  h.debug.setTick(END_TICK - 1);
  h.debug.setLevel(LEVEL);
  h.debug.setKills(KILLS);
  h.debug.setHp(0);
  const ended = await advanceTicks(h, 1);
  assertEqual(ended.screen, "fallen", "the screen the ending tick left");
  assertEqual(ended.run.tick, END_TICK, "the run clock the screen reports");

  const { calls } = await h.frameDraw();
  captureStill(h, "fallen");
  const lines = drawnText(calls);

  assertTrue(
    drewText(calls, FALLEN_TEXT),
    `the fallen screen drew ${FALLEN_TEXT} (specs/ui.md, fallen and dawn)`,
  );
  assertTrue(
    drewText(calls, clockText(END_TICK)),
    `the fallen screen drew the time survived, ${clockText(END_TICK)}`,
  );
  assertTrue(
    hasToken(lines, String(LEVEL)),
    `the fallen screen drew the level reached, ${LEVEL}`,
  );
  assertTrue(
    hasToken(lines, String(KILLS)),
    `the fallen screen drew the kill count, ${KILLS}`,
  );

  const draws = textDraws(calls);
  const first = anchorY(draws, END_ITEMS[0]);
  const second = anchorY(draws, END_ITEMS[1]);
  assertNotNull(first, `where ${END_ITEMS[0]} was drawn`);
  assertNotNull(second, `where ${END_ITEMS[1]} was drawn`);
  assertLessThan(
    first as number,
    second as number,
    `${END_ITEMS[0]} listed above ${END_ITEMS[1]}, in device pixels down the stage`,
  );
});
