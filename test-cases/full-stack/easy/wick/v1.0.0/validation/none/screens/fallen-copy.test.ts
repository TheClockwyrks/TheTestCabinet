// screens/fallen-copy — the fallen screen draws its heading, the run's figures,
// and its menu.
//
// WHERE THE THRESHOLD COMES FROM. specs/ui.md ("`fallen` and `dawn`"): "The two
// ends of a run. `fallen` shows `FALLEN_TEXT` (`THE LIGHT WENT OUT`) ... each
// shows the run's figures and the same menu below them", over the table "Time
// survived | The run clock at the end, as `m:ss`", "Level | The level
// reached", "Kills | The kill count", "Menu | `END_ITEMS`: `TRY AGAIN`,
// `TITLE`, in that order." The clock's format is specs/ui.md's own, "as `m:ss`,
// counting up from `0:00` in whole seconds, the seconds always two digits",
// which `clockText` restates.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night with a clock, a level and
// a kill count posed to figures no fresh run carries, so a screen drawn from
// defaults fails, and then ended fallen the real way: specs/world.md ("Fallen
// and dawn") ends a run "at the end of a tick" when "`hp` is `0` or below", and
// `setHp(0)` "ends the run fallen at the end of the next `playing` tick"
// (specs/instrumentation.md). The clock is posed one tick short of the figure
// read, because the ending tick is itself a tick of the run.
//
// THE TOLERANCE. The copy is matched ignoring case and whitespace, across the
// runs of text the frame drew joined in reading order (the shared harness's
// `drewTextAnywhere`) — and the level and the kill count are matched as whole
// numbers standing alone rather than as
// digits inside another figure, because specs/ui.md fixes the figures and not
// the words around them. The menu's order is a strict inequality between two
// drawn rows.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { clockText, END_ITEMS, FALLEN_TEXT } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import {
  assertNames,
  assertShows,
  assertStacked,
  endFallen,
  night,
  shown,
} from "./stage";

/** The clock the run ends at, and the figures it ends holding. */
const POSED = { tick: 3661, level: 7, kills: 250 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws THE LIGHT WENT OUT, the run's figures, and TRY AGAIN above TITLE", async () => {
  await night(h);
  await h.debug.setTick(POSED.tick - 1);
  await h.debug.setLevel(POSED.level);
  await h.debug.setKills(POSED.kills);
  const ended = await endFallen(h);
  assertEqual(ended.run.tick, POSED.tick, "the run clock the ending tick left");

  const page = await shown(h);
  await captureStill(h, "fallen");

  assertShows(page, FALLEN_TEXT, "the fallen screen");
  assertShows(page, clockText(POSED.tick), "the fallen screen's time survived");
  assertNames(page, String(POSED.level), "the fallen screen's level");
  assertNames(page, String(POSED.kills), "the fallen screen's kill count");
  assertShows(page, END_ITEMS[0], "the fallen screen's menu");
  assertShows(page, END_ITEMS[1], "the fallen screen's menu");
  assertStacked(page, END_ITEMS[0], END_ITEMS[1], "the fallen screen's menu");
});
