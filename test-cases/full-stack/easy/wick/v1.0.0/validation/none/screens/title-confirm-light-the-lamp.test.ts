// screens/title-confirm-light-the-lamp — `confirm` on `LIGHT THE LAMP` starts a
// fresh run.
//
// WHERE THE THRESHOLD COMES FROM. specs/ui.md ("`title`"): "`confirm` takes the
// highlighted item", and the item row "`LIGHT THE LAMP` | Starts a fresh run,
// defined below, and sets `screen = playing`." specs/ui.md ("A fresh run"): "A
// fresh run has the run clock at `0:00`, the lamplighter at the world origin
// `(0, 0)` with `hp = BASE_MAX_HP` (`100`) and `facing = "right"`, level `1`
// with `xp = 0` and `kills = 0`, Taper at level `1` alone in the first weapon
// slot and no passive held ... no level-up queued". specs/controls.md ("Actions
// and bindings") fixes what the frame of the press does: "a frame of `TICK_DT`
// whose press lights the lamp leaves the run at tick `1`", so the run is read
// one tick into the night.
//
// WHY THE WORLD IS POSED AS IT IS. Nothing is posed: the requirement is about
// the route a player takes, so the game is left exactly as the harness's
// opening reset leaves it — on `title`, with `LIGHT THE LAMP` highlighted at
// `menuIndex` `0` — and one REAL `Enter` is pressed through Chromium's input
// pipeline. The figures read are the ones a single tick cannot move: no key is
// held, so the lamplighter does not walk, and the night's first spawn stands
// `SPAWN_DISTANCE` away, so nothing reaches it. What the run holds at tick `0`
// is `fresh-run-state`.
//
// THE TOLERANCE. None: a screen name, a tick count, a slot's id and level, and
// the fresh run's figures are exact comparisons.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { BASE_MAX_HP } from "../constants";
import {
  captureStill,
  createHarness,
  player,
  pressConfirm,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("enters playing on a fresh run when Enter takes LIGHT THE LAMP", async () => {
  const title = await h.snapshot();
  assertEqual(title.screen, "title", "the screen the press is made on");
  assertEqual(title.menuIndex, 0, "the highlighted item, LIGHT THE LAMP");

  const started = await pressConfirm(h);
  await captureStill(h, "started");

  assertEqual(started.screen, "playing", "the screen Enter left");
  assertEqual(
    started.run.tick,
    1,
    "the run clock after the frame that lit the lamp",
  );
  assertEqual(player(started).x, 0, "the lamplighter's x on a fresh run");
  assertEqual(player(started).y, 0, "the lamplighter's y on a fresh run");
  assertEqual(player(started).facing, "right", "facing on a fresh run");
  assertEqual(player(started).hp, BASE_MAX_HP, "hp on a fresh run");
  assertEqual(started.run.level, 1, "the level on a fresh run");
  assertEqual(started.run.xp, 0, "the experience on a fresh run");
  assertEqual(started.run.kills, 0, "the kill count on a fresh run");
  assertEqual((started.run.weapons ?? []).length, 1, "the weapon slots held");
  assertEqual(
    (started.run.weapons ?? [])[0]?.id,
    "taper",
    "the weapon in the first slot",
  );
  assertEqual(
    (started.run.weapons ?? [])[0]?.level,
    1,
    "Taper's level on a fresh run",
  );
  assertEqual((started.run.passives ?? []).length, 0, "the passive slots held");
  assertEqual(
    started.run.pendingLevelUps,
    0,
    "the level-ups queued on a fresh run",
  );
});
