// Wick — pointer/title-click-confirms: clicking LIGHT THE LAMP starts a fresh
// run.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/controls.md`, The pointer,
// rule 2, Click: "A primary press edge inside the rectangle of the item at
// `menuIndex` `i` sets `menuIndex` to `i` ... and then takes that item exactly
// as `confirm` on it does." `specs/ui.md`, "`title`": `TITLE_ITEMS` is
// `LIGHT THE LAMP`, `THE ALMANAC`, `HOW TO PLAY` "in that order", `menuIndex`
// is `0` on arriving, and `LIGHT THE LAMP` "Starts a fresh run, defined below,
// and sets `screen = playing`". "A fresh run" is that file's own paragraph:
// "the run clock at `0:00`, the lamplighter at the world origin `(0, 0)` with
// `hp = BASE_MAX_HP` (`100`) and `facing = "right"`, level `1` with `xp = 0`
// and `kills = 0`, Taper at level `1` alone in the first weapon slot".
//
// WHY THE CLOCK READS TICK 1. `specs/controls.md`, Actions and bindings: "The
// frame's update then runs on the screen the edges left: a frame whose press
// enters `playing` ... runs that frame's ticks, so a frame of `TICK_DT` whose
// press lights the lamp leaves the run at tick `1`". The click is delivered by
// one whole-tick frame, so what is read is the fresh run one tick along: the
// fields a single tick of a run holding nothing cannot move.
//
// THE DRIVE. `reset` to the title screen, the first item's rectangle read off
// `menuRects`, and a primary press and release in its middle before the frame
// that reads the edge. The point is the build's own, never a coordinate this
// check chose. The driver switches are on, as `reset` leaves them, so the tick
// that frame runs is the game's own.
//
// THE TOLERANCE. None: a screen name, a tick count, whole levels and counts,
// and a position the lamplighter never left.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { BASE_MAX_HP, TITLE_ITEMS } from "../constants";
import {
  captureStill,
  clickRect,
  createHarness,
  menuRects,
  type Harness,
} from "../harness";

/** The index of LIGHT THE LAMP, the first item of TITLE_ITEMS (specs/ui.md). */
const LIGHT_THE_LAMP = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("enters playing on a fresh run when a click takes LIGHT THE LAMP", async () => {
  h.reset();
  const before = h.snapshot();
  assertEqual(before.screen, "title", "the screen the click is made on");
  assertEqual(before.menuIndex, LIGHT_THE_LAMP, "the highlighted item");

  const rects = menuRects(h);
  assertLength(
    rects,
    TITLE_ITEMS.length,
    "the title menu's rectangles, one per item (specs/controls.md, The pointer)",
  );

  const after = await clickRect(h, rects[LIGHT_THE_LAMP]);
  captureStill(h, "click");

  assertEqual(
    after.screen,
    "playing",
    "the screen after a click on LIGHT THE LAMP (specs/controls.md, Click)",
  );
  assertEqual(after.run.tick, 1, "the run clock after the click's own tick");
  assertEqual(after.run.level, 1, "the level a fresh run starts at");
  assertEqual(after.run.xp, 0, "the experience a fresh run starts with");
  assertEqual(after.run.kills, 0, "the kills a fresh run starts with");
  assertEqual(after.run.player.x, 0, "the lamplighter's x at the world origin");
  assertEqual(after.run.player.y, 0, "the lamplighter's y at the world origin");
  assertEqual(
    after.run.player.facing,
    "right",
    "the facing a fresh run starts with",
  );
  assertEqual(after.run.player.hp, BASE_MAX_HP, "hp on a fresh run");
  assertLength(after.run.weapons, 1, "the weapons a fresh run holds");
  assertEqual(after.run.weapons[0].id, "taper", "the weapon in the first slot");
  assertEqual(after.run.weapons[0].level, 1, "that weapon's level");
});
