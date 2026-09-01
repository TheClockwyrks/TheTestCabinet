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
// count whose spellings no two of them share, ended through `setScreen`, which
// "Ends the run exactly as that ending does, the run kept for the end screen to
// report" (specs/instrumentation.md). One frame is then drawn and its runs of
// text are read as one corpus.
//
// THE TOLERANCE. Every piece of copy is matched as its words in order through
// `drewPhrase`, which admits any label, font, wrap, or marker a build puts
// around it, and each figure is matched as a whole number so a neighbouring
// figure cannot supply it. The menu's order is read as a strict inequality
// between the topmost anchor of each item, which fixes no layout beyond the one
// relation specs/ui.md states.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertLessThan } from "../assert";
import { END_ITEMS, FALLEN_TEXT, clockText } from "../constants";
import {
  captureStill,
  createHarness,
  drewPhrase,
  isolate,
  present,
  topAnchorOf,
  type Harness,
} from "../harness";

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
  h.debug.setTick(TICK);
  h.debug.setKills(KILLS);
  h.debug.setScreen("fallen");
  const ended = h.snapshot();
  assertEqual(ended.screen, "fallen", "the screen the frame is read from");

  const { calls } = await h.frameDraw();
  captureStill(h, "fallen");

  const copy = [
    FALLEN_TEXT,
    clockText(TICK),
    String(LEVEL),
    String(KILLS),
    ...END_ITEMS,
  ];
  assertDeepEqual(
    copy.filter((text) => !drewPhrase(calls, text)),
    [],
    "the copy specs/ui.md gives the fallen screen, missing from its frame",
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
