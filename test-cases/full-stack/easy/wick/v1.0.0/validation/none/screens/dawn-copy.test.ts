// screens/dawn-copy — the dawn screen draws its heading, the run's figures, and
// its menu.
//
// WHERE THE THRESHOLD COMES FROM. specs/ui.md ("`fallen` and `dawn`"): "The two
// ends of a run ... `dawn` shows `DAWN_TEXT` (`DAWN`); each shows the run's
// figures and the same menu below them", over the table "Time survived | The
// run clock at the end, as `m:ss`", "Level | The level reached", "Kills | The
// kill count", "Menu | `END_ITEMS`: `TRY AGAIN`, `TITLE`, in that order." The
// clock at dawn is fixed: specs/world.md ("Fallen and dawn") ends the run when
// "`tick` equals `DAWN_TIME x TICK_HZ` (`36000`)", which is `10:00` in the
// format specs/ui.md gives the clock, and specs/ui.md ("`howto`") names the
// same figure.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night with a level and a kill
// count posed to figures no fresh run carries, so a screen drawn from defaults
// fails, and then run to dawn the real way: the clock posed to
// `MAX_POSED_TICK` (`35999`), the greatest `setTick` accepts, and the tick that
// reaches `36000`. Every driver switch is off, so nothing spawns into the last
// tick and nothing else moves a figure the screen reports.
//
// THE TOLERANCE. The copy is matched folded, the level and the kill count are
// matched as whole numbers standing alone, and the menu's order is a strict
// inequality between two drawn rows.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { clockText, DAWN_TEXT, DAWN_TICK, END_ITEMS } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import {
  assertNames,
  assertShows,
  assertStacked,
  endDawn,
  night,
  shown,
} from "./stage";

/** The figures the run ends holding. */
const POSED = { level: 7, kills: 250 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws DAWN, 10:00, the run's figures, and TRY AGAIN above TITLE", async () => {
  await night(h);
  await h.debug.setLevel(POSED.level);
  await h.debug.setKills(POSED.kills);
  const ended = await endDawn(h);
  assertEqual(ended.run.tick, DAWN_TICK, "the run clock the ending tick left");

  const page = await shown(h);
  await captureStill(h, "dawn");

  assertShows(page, DAWN_TEXT, "the dawn screen");
  assertShows(page, clockText(DAWN_TICK), "the dawn screen's time survived");
  assertNames(page, String(POSED.level), "the dawn screen's level");
  assertNames(page, String(POSED.kills), "the dawn screen's kill count");
  assertShows(page, END_ITEMS[0], "the dawn screen's menu");
  assertShows(page, END_ITEMS[1], "the dawn screen's menu");
  assertStacked(page, END_ITEMS[0], END_ITEMS[1], "the dawn screen's menu");
});
