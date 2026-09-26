// screens/fallen-copy — the fallen screen draws its copy.
//
// WHAT THIS DECIDES. One thing: the fallen frame carries `FALLEN_TEXT`, the
// three figures of the run it reports, and the two menu items in the order
// `END_ITEMS` gives them. That the figures are the run that JUST ENDED, rather
// than some other run, is `end-screen-figures`.
//
// THE SPEC IT RESTS ON.
//   specs/ui.md ("`fallen` and `dawn`"): "`fallen` shows `FALLEN_TEXT` (`THE
//   LIGHT WENT OUT`) ... each shows the run's figures and the same menu below
//   them", with the table "Time survived | The run clock at the end, as `m:ss`",
//   "Level | The level reached", "Kills | The kill count", and "Menu |
//   `END_ITEMS`: `TRY AGAIN`, `TITLE`, in that order".
//   specs/ui.md (`playing`, the HUD table): a clock is drawn "as `m:ss` ... the
//   seconds always two digits", which `clockText` spells.
//
// THE DRIVE. An isolated `playing` run posed with a clock, a level, and a kill
// count whose spellings no two of them share, ended the way the rule ends it:
// "the fallen ending is `setHp` at `0` and one tick"
// (specs/instrumentation.md), which is what `endFallen` composes. The clock is
// posed one tick short of `TICK` so the ending tick is the one that reaches it.
// One frame is then drawn and its runs of text are read.
//
// THE TOLERANCE. The heading is matched as a substring of the frame's text
// through the shared harness's `drewTextAnywhere`, ignoring case and whitespace
// across every run the frame drew, and each menu item as a substring of a run
// through its `drewText`, which admit any label, font, or marker a build puts
// around them; the clock and each figure are matched as a whole token so a
// neighbouring figure cannot supply them. The menu's order is read as a strict inequality
// between the topmost anchor of each item, which fixes no layout beyond the one
// relation specs/ui.md states.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertLessThan,
  assertTrue,
} from "../assert";
import { END_ITEMS, FALLEN_TEXT, clockText } from "../constants";
import {
  captureStill,
  createHarness,
  endFallen,
  hasToken,
  isolate,
  present,
  textReadings,
  topAnchorOf,
  type Harness,
} from "../harness";
import { drewText, drewTextAnywhere } from "../case-harness/text";

let h: Harness;

/** A clock, a level, and a kill count no two of which share a spelling. */
const TICK = 7523;
const LEVEL = 12;
const KILLS = 87;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("draws THE LIGHT WENT OUT, the run's figures, and the end menu", async () => {
  isolate(h, { level: LEVEL });
  h.debug.setTick(TICK - 1);
  h.debug.setKills(KILLS);
  await endFallen(h);
  const ended = h.snapshot();
  assertEqual(ended.screen, "fallen", "the screen the frame is read from");

  const { calls } = await h.frameDraw();
  captureStill(h, "fallen");

  assertTrue(
    drewTextAnywhere(calls, FALLEN_TEXT),
    `the fallen screen drew ${FALLEN_TEXT} (specs/ui.md, fallen and dawn)`,
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
  const figures = [clockText(TICK), String(LEVEL), String(KILLS)];
  assertDeepEqual(
    figures.filter((figure) => !hasToken(lines, figure)),
    [],
    "the run's figures specs/ui.md gives the fallen screen, missing from its frame",
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
