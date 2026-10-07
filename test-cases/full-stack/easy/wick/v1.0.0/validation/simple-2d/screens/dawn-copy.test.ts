// screens/dawn-copy — the dawn screen draws its copy.
//
// WHAT THIS DECIDES. One thing: the dawn frame carries `DAWN_TEXT`, the three
// figures of the run it reports, with the clock reading the full night, and the
// two menu items in the order `END_ITEMS` gives them.
//
// THE SPEC IT RESTS ON.
//   specs/ui.md ("`fallen` and `dawn`"): "`dawn` shows `DAWN_TEXT` (`DAWN`);
//   each shows the run's figures and the same menu below them", with the table
//   "Time survived | The run clock at the end, as `m:ss`", "Level | The level
//   reached", "Kills | The kill count", and "Menu | `END_ITEMS`: `TRY AGAIN`,
//   `TITLE`, in that order".
//   specs/world.md ("Fallen and dawn"): "Dawn | `tick` equals `DAWN_TIME ×
//   TICK_HZ` (`36000`)", so the clock a dawn screen reports is
//   `clockText(DAWN_TICK)`, `10:00`.
//
// THE DRIVE, AND WHY THE CLOCK IS RUN INTO. `setTick` takes a tick "from `0` to
// `DAWN_TIME × TICK_HZ − 1` (`35999`)" (specs/instrumentation.md), so the dawn
// tick is not posable and the screen is reached the way play reaches it: an
// isolated `playing` run posed one tick short of dawn, with a level and a kill
// count, and the single tick that crosses into `36000` and ends the run. Every
// driver switch is off, so that tick brings nothing else with it.
//
// THE TOLERANCE. The heading is matched as a substring of the frame's text
// through the shared harness's `drewTextAnywhere`, ignoring case and whitespace
// across every run the frame drew, and each menu item as a substring of a run
// through its `drewText`; the clock and each figure are matched as a whole
// token so a neighbouring figure cannot supply them. The menu's order is read as a strict inequality between
// anchors, fixing no layout beyond the relation specs/ui.md states.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertLessThan,
  assertTrue,
} from "../assert";
import { DAWN_TEXT, DAWN_TICK, END_ITEMS, clockText } from "../constants";
import {
  captureStill,
  createHarness,
  hasToken,
  isolate,
  present,
  textReadings,
  topAnchorOf,
  type Harness,
} from "../harness";
import { drewText, drewTextAnywhere } from "../case-harness/text";

let h: Harness;

/** A level and a kill count that share no spelling with the dawn clock. */
const LEVEL = 12;
const KILLS = 87;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("draws DAWN, the run's figures at 10:00, and the end menu", async () => {
  isolate(h, { level: LEVEL });
  h.debug.setKills(KILLS);
  h.debug.setTick(DAWN_TICK - 1);
  const ended = await h.tick(1);
  assertEqual(
    ended.screen,
    "dawn",
    "the screen the tick that reached dawn left",
  );
  assertEqual(ended.run.tick, DAWN_TICK, "the tick the run ended at");

  const { calls } = await h.frameDraw();
  captureStill(h, "dawn");

  assertTrue(
    drewTextAnywhere(calls, DAWN_TEXT),
    `the dawn screen drew ${DAWN_TEXT} (specs/ui.md, fallen and dawn)`,
  );
  assertDeepEqual(
    END_ITEMS.filter((item) => !drewText(calls, item)),
    [],
    "the items specs/ui.md gives the end menu, missing from its frame",
  );
  // The raw calls and the logical runs they spell, both (`textReadings`): a
  // figure drawn a glyph per call is the number it is off the runs, and one
  // drawn a narrow gap after its label, which the run rule merges into
  // `KILLS87`, still stands alone as the raw call.
  const lines = textReadings(calls);
  const figures = [clockText(DAWN_TICK), String(LEVEL), String(KILLS)];
  assertDeepEqual(
    figures.filter((figure) => !hasToken(lines, figure)),
    [],
    "the run's figures specs/ui.md gives the dawn screen, missing from its frame",
  );

  const first = present(
    topAnchorOf(calls, END_ITEMS[0]),
    `where the frame drew ${END_ITEMS[0]}`,
  );
  const second = present(
    topAnchorOf(calls, END_ITEMS[1]),
    `where the frame drew ${END_ITEMS[1]}`,
  );
  assertLessThan(
    first,
    second,
    `${END_ITEMS[0]} drawn above ${END_ITEMS[1]}, in END_ITEMS order`,
  );
});
