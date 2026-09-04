// hurt/flash-clear-on-fresh-run — a fresh run starts with no hurt flash.
//
// WHERE THE THRESHOLD COMES FROM. specs/ui.md ("A fresh run"): "`LIGHT THE
// LAMP`, `TRY AGAIN`, and the debug surface's `setScreen("playing")` each begin
// a fresh run, and whatever the previous run held is discarded. A fresh run has
// the run clock at `0:00`, the lamplighter at the world origin `(0, 0)` with
// `hp = BASE_MAX_HP` (`100`), `facing = "right"`, and `hurtFlash` at `0`".
// specs/world.md ("Contact damage") says the same of the timer: "It is `0` on
// the idle run and on a fresh run". So a flash still running when a run ends is
// not carried into the run that follows it.
//
// WHICH ITEM IS TAKEN. specs/ui.md ("`fallen` and `dawn`"): "Menu | `END_ITEMS`:
// `TRY AGAIN`, `TITLE`, in that order", "`menuIndex` is `0` on arriving", and
// "`confirm` takes the highlighted item: `TRY AGAIN` starts a fresh run and sets
// `screen = playing`". So a real `Enter` on the fallen screen takes `TRY AGAIN`.
//
// HOW THE RUN IS ENDED WITH THE FLASH RUNNING. The category's isolated night
// with `enemyContact` on, health posed to the rat's damage of 8
// (specs/enemies.md), and the tick a rat overlapping the lamplighter hits on:
// `hp` falls by "`max(MIN_DAMAGE_TAKEN, enemy damage - armor)`" to 0 with
// `armor` 0, the same tick sets `hurtFlash` to `HURT_FLASH`, and specs/world.md
// ("Fallen and dawn") ends the run fallen at the end of it, "`hp` is `0` or
// below". Nothing advances on `fallen`, so the timer is still running when the
// press lands, which the reading taken there guards.
//
// THE TOLERANCE. `TIMER_TOL` (`1e-6`): the specification states the figure as
// `0` outright, and the allowance covers a build that clears the timer by
// arithmetic of its own. A build that carried the flash across reads the `0.3`
// the ending tick left, five orders outside.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { END_ITEMS, ENEMIES, HURT_FLASH, TIMER_TOL } from "../constants";
import {
  captureStill,
  createHarness,
  pressConfirm,
  type Harness,
} from "../harness";
import { armFlash, flashOf, poseNight } from "./flash";

/** The index of `TRY AGAIN`, the item a run ends highlighted on. */
const TRY_AGAIN = END_ITEMS.indexOf("TRY AGAIN");

/** The health posed before the hit: exactly the rat's damage, so the hit ends the run. */
const LAST_HEALTH = ENEMIES.rat.damage;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reads hurtFlash 0 on the run TRY AGAIN begins after a hit ended the last", async () => {
  await poseNight(h);
  await h.debug.setHp(LAST_HEALTH);
  const { armed } = await armFlash(h);
  assertEqual(
    armed.screen,
    "fallen",
    "the screen the hit that ended the run left",
  );
  assertEqual(armed.menuIndex, TRY_AGAIN, "the highlighted item, TRY AGAIN");
  assertNear(
    flashOf(armed),
    HURT_FLASH,
    TIMER_TOL,
    "run.hurtFlash on the ending tick, which the fresh run must not inherit",
  );

  const fresh = await pressConfirm(h);

  // The first frame of the fresh run. Captured before the assertion, so a
  // failing build leaves the picture that shows why.
  await captureStill(h, "fresh");

  assertEqual(fresh.screen, "playing", "the screen TRY AGAIN left");
  assertNear(
    flashOf(fresh),
    0,
    TIMER_TOL,
    "run.hurtFlash on the fresh run TRY AGAIN began",
  );
});
