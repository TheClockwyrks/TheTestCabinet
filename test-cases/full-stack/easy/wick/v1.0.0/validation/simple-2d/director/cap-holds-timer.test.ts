// director/cap-holds-timer — while the cap is met the timer spawns nothing and
// rests at zero.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/enemies.md` ("The spawn timer"): "if `spawnTimer` is due and
//     `aliveCommons` < `cap`: spawn one enemy ... `spawnTimer` = `interval`",
//     and "When the cap is full the timer rests at `0`, and the next spawn
//     lands on the first tick that has room."
//   - `specs/world.md` ("Timers"): "a count-down that would leave it below
//     `TICK_DT / 2` leaves it at exactly `0`", and "a timer at `0` stays due on
//     every tick until it is set again".
//   - `specs/enemies.md` ("Windows"): row 0 applies from 0:00 with an interval
//     of 1.00 and a cap of 20.
//   - `specs/enemies.md` ("The cap"): "`aliveCommons` is the number of live
//     enemies of rank `common` other than gnats."
//
// WHAT IS READ. Twenty moths, window 0's cap, are posed on the field and the
// timer is left resting at 0. Across 120 ticks, two whole intervals, no enemy
// may be added, and the timer must still read 0 at the end: the cap holds the
// spawn without consuming the timer, which is what makes the next tick with
// room spawn at once.
//
// WHY THE NIGHT IS POSED AS IT IS. `spawning` alone is on: the twenty moths
// stand still, are hit by nothing, and are removed by nothing, so
// `aliveCommons` stays at 20 for the whole stretch and the cap is the only
// thing that can hold a spawn back.
//
// TOLERANCE. None: a count of enemies, and a timer the rule holds at exactly 0.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { SPAWN_WINDOWS, ticksFor } from "../constants";
import {
  captureStill,
  createHarness,
  enable,
  isolate,
  type Harness,
} from "../harness";
import { poseRing, poseWindow } from "./stage";

const ROW = SPAWN_WINDOWS[0];

/** Two of window 0's intervals: 120 ticks, two spawns the cap must refuse. */
const HELD_TICKS = 2 * ticksFor(ROW.interval);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("lands no spawn and rests the timer at zero while the cap is met", async () => {
  isolate(h);
  enable(h, "spawning");
  poseWindow(h, 0);
  poseRing(h, "moth", ROW.cap);

  const held = await h.tick(HELD_TICKS);
  captureStill(h, "capped");

  assertEqual(
    held.run.aliveCommons,
    ROW.cap,
    "the commons alive against the cap",
  );
  assertLength(
    held.run.enemies,
    ROW.cap,
    "enemies on the field after 120 ticks",
  );
  assertEqual(held.run.spawnTimer, 0, "the spawn timer while the cap is met");
});
