// Wick — pointer/end-click-confirms: on the fallen screen a click on TRY AGAIN
// starts a fresh run.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/controls.md`, The pointer,
// rule 2, Click: "A primary press edge inside the rectangle of the item at
// `menuIndex` `i` sets `menuIndex` to `i` ... and then takes that item exactly
// as `confirm` on it does." `specs/ui.md`, "`fallen` and `dawn`": the menu is
// `END_ITEMS` ("`TRY AGAIN`, `TITLE`, in that order"), "`menuIndex` is `0` on
// arriving", and "`confirm` takes the highlighted item: `TRY AGAIN` starts a
// fresh run and sets `screen = playing`". "A fresh run" is that file's own
// paragraph: the run clock at `0:00`, the lamplighter at the world origin with
// `hp = BASE_MAX_HP` (`100`) and `facing = "right"`, level `1` with `xp = 0`
// and `kills = 0`, and "Taper at level `1` alone in the first weapon slot".
//
// WHY THE CLOCK READS TICK 1. `specs/controls.md`: "a frame whose press enters
// `playing` ... runs that frame's ticks", so the clicking frame is the new
// run's first tick. Every driver switch is off, so that tick spawns nothing and
// fires nothing, and the figures read are the ones a fresh run holds.
//
// THE DRIVE. An isolated `playing` run with every driver switch off, its level
// and its kill count posed so an inherited run is unmistakable, ended fallen by
// posing `hp` to `0` and running the one tick `specs/world.md` ends the run on;
// then a primary press and release in the middle of `TRY AGAIN`'s own
// rectangle, read off `menuRects`, before the frame that reads the edge.
//
// THE TOLERANCE. None: a screen name, whole counts, a slot's contents, and a
// position the lamplighter never left.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertLength } from "../assert";
import { BASE_MAX_HP, END_ITEMS } from "../constants";
import {
  FRESH_WEAPONS,
  captureStill,
  clickRect,
  createHarness,
  endFallen,
  isolate,
  menuRects,
  type Harness,
} from "../harness";

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

it("enters playing on a fresh run when a click takes TRY AGAIN", async () => {
  isolate(h);
  h.debug.setLevel(LEVEL);
  h.debug.setKills(KILLS);
  const ended = await endFallen(h);
  assertEqual(ended.screen, "fallen", "the screen the click is made on");
  assertEqual(ended.menuIndex, TRY_AGAIN, "the highlighted item, TRY AGAIN");
  assertEqual(ended.run.level, LEVEL, "the level the ended run reached");

  const rects = menuRects(h);
  assertLength(
    rects,
    END_ITEMS.length,
    "the end menu's rectangles, one per item (specs/controls.md, The pointer)",
  );

  const after = await clickRect(h, rects[TRY_AGAIN]);
  captureStill(h, "again");

  assertEqual(
    after.screen,
    "playing",
    "the screen after a click on TRY AGAIN (specs/controls.md, Click)",
  );
  assertEqual(after.run.tick, 1, "the run clock after the click's own tick");
  assertEqual(after.run.level, 1, "the level a fresh run starts at");
  assertEqual(after.run.xp, 0, "the experience a fresh run starts with");
  assertEqual(after.run.kills, 0, "the kills a fresh run starts with");
  assertEqual(after.run.player.x, 0, "the lamplighter's x, the world origin");
  assertEqual(after.run.player.y, 0, "the lamplighter's y, the world origin");
  assertEqual(
    after.run.player.facing,
    "right",
    "the facing a fresh run starts with",
  );
  assertEqual(after.run.player.hp, BASE_MAX_HP, "hp on a fresh run");
  assertDeepEqual(
    after.run.weapons,
    FRESH_WEAPONS,
    "the loadout a fresh run starts with (specs/ui.md, A fresh run)",
  );
  assertLength(after.run.passives, 0, "the passives a fresh run holds");
});
