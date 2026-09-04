// pointer/paused-click-main-menu — a click inside `MAIN MENU`'s rectangle
// abandons the run.
//
// WHERE THE THRESHOLD COMES FROM. specs/controls.md ("The pointer"), rule 2: "A
// primary press edge inside the rectangle of the item at `menuIndex` `i` sets
// `menuIndex` to `i`, playing `menu-move` if that changed it, and then takes
// that item exactly as `confirm` on it does." specs/ui.md ("`paused`"):
// "`MAIN MENU` | Abandons the run and returns to `title` with `menuIndex = 0`",
// the second item of `PAUSE_ITEMS`, with "`menuIndex` is `0` on arriving" at the
// pause screen. specs/state.md's idle run is what an abandoned run leaves:
// specs/instrumentation.md has `setScreen("title")` discard a run "exactly as
// `TITLE` on an end screen or `MAIN MENU` on `paused` does: the idle run".
// specs/ui.md ("What advances on each screen") has nothing advance on `title`,
// so the clicking frame leaves the idle run where it found it.
//
// WHAT IS READ, AND WHY IT DECIDES THE CLAIM. The screen, the highlight, and the
// whole documented run against the idle run field for field. A build that
// returned to the title while keeping the run fails on the run; a build that
// discarded the run without leaving `paused` fails on the screen.
//
// HOW THE WORLD IS POSED. The night is isolated and then given a clock, a level,
// experience, kills, a health short of full, a lamplighter off the origin, a
// loadout, an enemy, a gem and a pickup, because "abandons the run" is only
// visible against a run that has something in it. The pause is posed through
// `setScreen("paused")`, which specs/instrumentation.md defines as "Exactly as
// `pause` does".
//
// HOW THE GESTURE IS POSED. `menuRects()` reports where this build drew the two
// pause items, and the primary button is pressed at the middle of the SECOND,
// `MAIN MENU`, from the `menuIndex` `0` the pause screen is entered on, so the
// click both moves the highlight and takes the item it landed in.
//
// THE TOLERANCE. None: the documented run is compared field for field against
// the idle run, and a screen name and an index are exact.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual } from "../assert";
import { PAUSE_ITEMS } from "../constants";
import {
  captureStill,
  clickAt,
  createHarness,
  documentedRun,
  holdPassive,
  holdWeapon,
  idleRun,
  placeEnemy,
  placeGem,
  placePickup,
  type Harness,
} from "../harness";
import { assertHighlight, menuPoints, night, posePaused } from "./stage";

/** The item the click lands in: `MAIN MENU`, the second of `PAUSE_ITEMS`. */
const CLICKED = PAUSE_ITEMS.indexOf("MAIN MENU");

/** Figures the abandoned night carries, none of them an idle run's. */
const POSED = {
  tick: 4500,
  level: 7,
  xp: 12,
  kills: 250,
  hp: 77,
  x: 300,
  y: -120,
};

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("returns to title with the idle run when a click lands in MAIN MENU", async () => {
  await night(h);
  await holdWeapon(h, "ember", 3);
  await holdPassive(h, "brass", 2);
  await h.debug.setTick(POSED.tick);
  await h.debug.setLevel(POSED.level);
  await h.debug.setXp(POSED.xp);
  await h.debug.setKills(POSED.kills);
  await h.debug.setHp(POSED.hp);
  await h.debug.setPlayerPosition(POSED.x, POSED.y);
  await placeEnemy(h, "moth", POSED.x + 200, POSED.y);
  await placeGem(h, "medium", POSED.x - 200, POSED.y);
  await placePickup(h, "bread", POSED.x, POSED.y - 200);
  await posePaused(h);
  const points = await menuPoints(h, PAUSE_ITEMS.length, "for the pause menu");

  const abandoned = await clickAt(h, points[CLICKED]!);
  await captureStill(h, "abandoned");

  assertHighlight(
    abandoned,
    "title",
    0,
    "after a click inside MAIN MENU's rectangle",
  );
  assertDeepEqual(
    documentedRun(abandoned.run),
    idleRun(),
    "the run MAIN MENU leaves behind",
  );
});
