// Wick — screens/dawn-try-again: `TRY AGAIN` on the dawn screen starts a
// fresh run.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/ui.md`, "`fallen` and
// `dawn`": the menu is `END_ITEMS` (`TRY AGAIN`, `TITLE`, "in that order"),
// "`menuIndex` is `0` on arriving", and "`confirm` takes the highlighted item:
// `TRY AGAIN` starts a fresh run and sets `screen = playing`". "A fresh run"
// is that file's own paragraph: the run clock at `0:00`, the lamplighter at
// the world origin with `hp = BASE_MAX_HP` (`100`) and `facing = "right"`,
// level `1` with `xp = 0` and `kills = 0`, and "Taper at level `1` alone in
// the first weapon slot". `specs/controls.md` binds `confirm` to `Enter` and
// `Space`.
//
// WHY THE CLOCK READS TICK 1. `specs/controls.md`: "a frame whose press enters
// `playing` ... runs that frame's ticks", so the pressing frame is the new
// run's first tick. Every driver switch is off, so that tick spawns nothing
// and fires nothing, and the figures read are the ones a fresh run holds.
//
// THE DRIVE. An isolated `playing` run with every driver switch off, its level
// and its kill count posed so an idle or a fresh run is unmistakable, ended at
// dawn by posing the clock to `LAST_TICK` (`35999`) and running the one tick
// that carries it to `DAWN_TIME × TICK_HZ` (`36000`). Then one real `Enter`, on
// the item the arrival highlights.
//
// THE TOLERANCE. None: a screen name, whole counts, a slot's contents, and a
// position the lamplighter never left.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertLength } from "../assert";
import { BASE_MAX_HP } from "../constants";
import {
  FRESH_WEAPONS,
  captureStill,
  createHarness,
  endDawn,
  isolate,
  tap,
  type Harness,
} from "../harness";

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

it("enters playing on a fresh run when Enter takes TRY AGAIN", async () => {
  isolate(h);
  h.debug.setLevel(LEVEL);
  h.debug.setKills(KILLS);
  const ended = await endDawn(h);
  assertEqual(ended.screen, "dawn", "the screen the press is made on");
  assertEqual(ended.menuIndex, 0, "the highlighted item, TRY AGAIN");
  assertEqual(ended.run.level, LEVEL, "the level the ended run reached");

  const after = await tap(h, "Enter");
  captureStill(h, "again");

  assertEqual(after.screen, "playing", "the screen after confirming TRY AGAIN");
  assertEqual(after.run.tick, 1, "the run clock after the press's own tick");
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
