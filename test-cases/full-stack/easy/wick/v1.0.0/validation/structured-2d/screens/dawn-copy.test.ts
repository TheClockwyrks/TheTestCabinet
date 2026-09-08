// Wick — screens/dawn-copy: the dawn screen draws its heading, the run's three
// figures, and its two menu items in order.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/ui.md`, "`fallen` and
// `dawn`": "`dawn` shows `DAWN_TEXT` (`DAWN`); each shows the run's figures
// and the same menu below them", and the table gives Time survived as "The run
// clock at the end, as `m:ss`", Level as "The level reached", Kills as "The
// kill count", and Menu as "`END_ITEMS`: `TRY AGAIN`, `TITLE`, in that order".
// `specs/world.md`, "Fallen and dawn", ends a run at dawn on the tick "`tick`
// equals `DAWN_TIME × TICK_HZ` (`36000`)", so the clock a dawn screen reports
// is always `10:00`.
//
// WHAT IS READ, AND WHY. The heading and the two menu items as drawn copy, the
// three figures as whole tokens among the runs of text the frame drew, and the
// two items' anchors, which must descend in the order `END_ITEMS` lists.
//
// THE DRIVE. An isolated `playing` run with every driver switch off, the level
// and the kill count posed, the clock posed to `LAST_TICK` (`35999`), and the
// one tick that carries it to `36000` and ends the run at dawn.
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
import { DAWN_TEXT, DAWN_TICK, END_ITEMS, clockText } from "../constants";
import {
  captureStill,
  createHarness,
  endDawn,
  hasToken,
  isolate,
  placedRuns,
  textReadings,
  type Harness,
} from "../harness";
import { drewText } from "../case-harness/text";
import { anchorY } from "./stage";

/** The run the dawn screen reports: its level and its kills. */
const LEVEL = 4;
const KILLS = 88;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("draws DAWN, the figures, and TRY AGAIN above TITLE", async () => {
  isolate(h);
  h.debug.setLevel(LEVEL);
  h.debug.setKills(KILLS);
  const ended = await endDawn(h);
  assertEqual(ended.screen, "dawn", "the screen the ending tick left");
  assertEqual(ended.run.tick, DAWN_TICK, "the run clock the screen reports");

  const { calls } = await h.frameDraw();
  captureStill(h, "dawn");
  // The raw calls and the logical runs they spell, both (`textReadings`): a
  // figure drawn a glyph per call is the number it is off the runs, and one
  // drawn a narrow gap after its label, which the run rule merges into
  // `KILLS143`, still stands alone as the raw call.
  const lines = textReadings(calls);

  assertTrue(
    drewText(calls, DAWN_TEXT),
    `the dawn screen drew ${DAWN_TEXT} (specs/ui.md, fallen and dawn)`,
  );
  assertTrue(
    drewText(calls, clockText(DAWN_TICK)),
    `the dawn screen drew the time survived, ${clockText(DAWN_TICK)}`,
  );
  assertTrue(
    hasToken(lines, String(LEVEL)),
    `the dawn screen drew the level reached, ${LEVEL}`,
  );
  assertTrue(
    hasToken(lines, String(KILLS)),
    `the dawn screen drew the kill count, ${KILLS}`,
  );

  const draws = placedRuns(calls);
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
