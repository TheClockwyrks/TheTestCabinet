// Wick — pointer/end-touch-confirms: a contact landing and lifting in `TRY
// AGAIN`'s rectangle starts a fresh run.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/controls.md`, "The pointer
// and touch", rule 3: "a contact landing and lifting inside the rectangle of the
// item at `menuIndex` `i` selects that item and takes it exactly as `confirm` on
// it does." `specs/ui.md`, "`fallen`, `dawn`": `TRY AGAIN` "Starts a fresh run
// and sets `screen = playing`", over `END_ITEMS`, whose first item it is, with
// "A fresh run" fixing what that run holds.
//
// WHY THIS IS ITS OWN POINT. An end screen is where a player decides whether to
// play again, so a build that answers no contact there is one a touch player
// plays exactly once. The mouse's route is `pointer/end-click-confirms`'.
//
// WHAT IS READ. The screen and the fresh run's own figures, against a run that
// reached a level and a kill count neither of which a fresh run may inherit.
//
// THE DRIVE. An isolated night given a level and kills, ended fallen the real
// way; then a contact landing at the middle of `TRY AGAIN`'s rectangle and
// lifting there, one partial frame each, so the fresh run is read before a tick
// advances it.
//
// THE TOLERANCE. None: a screen name and the fresh run's figures.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertLength } from "../assert";
import { BASE_MAX_HP, END_ITEMS } from "../constants";
import {
  FRESH_WEAPONS,
  captureStill,
  createHarness,
  endFallen,
  isolate,
  menuRects,
  type Harness,
} from "../harness";
import { touchTapRectPartial } from "./pointing";

/** The index of TRY AGAIN, the first item of END_ITEMS (specs/ui.md). */
const TRY_AGAIN = 0;

/** The ended run's figures, none of which a fresh run may inherit. */
const LEVEL = 6;
const KILLS = 143;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("enters playing on a fresh run when a contact takes TRY AGAIN", async () => {
  h.reset();
  isolate(h);
  h.debug.setLevel(LEVEL);
  h.debug.setKills(KILLS);
  const ended = await endFallen(h);
  assertEqual(ended.screen, "fallen", "the screen the contact lands on");
  assertEqual(ended.menuIndex, TRY_AGAIN, "the highlighted item, TRY AGAIN");

  const rects = menuRects(h);
  assertLength(rects, END_ITEMS.length, "the end menu's rectangles");

  const after = await touchTapRectPartial(h, rects[TRY_AGAIN]);
  captureStill(h, "again");

  assertEqual(after.screen, "playing", "the screen the contact left");
  assertEqual(after.run.tick, 0, "the run clock the fresh run starts at");
  assertEqual(after.run.level, 1, "the level a fresh run starts at");
  assertEqual(after.run.xp, 0, "the experience a fresh run starts with");
  assertEqual(after.run.kills, 0, "the kills a fresh run starts with");
  assertEqual(after.run.player.x, 0, "the lamplighter's x, the world origin");
  assertEqual(after.run.player.y, 0, "the lamplighter's y, the world origin");
  assertEqual(after.run.player.hp, BASE_MAX_HP, "hp on a fresh run");
  assertDeepEqual(
    after.run.weapons,
    FRESH_WEAPONS,
    "the loadout a fresh run starts with (specs/ui.md, A fresh run)",
  );
  assertLength(after.run.passives, 0, "the passives a fresh run holds");
});
