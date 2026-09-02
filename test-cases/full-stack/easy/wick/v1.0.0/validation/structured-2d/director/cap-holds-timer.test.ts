// director/cap-holds-timer — a full field stops the window spawns.
//
// THE SPEC LINE. `specs/enemies.md`, "The spawn timer": the spawn is
// conditional — "if `spawnTimer` is due and `aliveCommons` < cap: spawn one
// enemy ... `spawnTimer` = interval" — and the paragraph under it says what
// happens when it is not: "When the cap is full the timer rests at `0`, and
// the next spawn lands on the first tick that has room." "The cap" defines
// `aliveCommons` as "the number of live enemies of rank `common` other than
// gnats". Row 0 of `SPAWN_WINDOWS` caps window 0 at `20`.
//
// WHY THE TIMER READS 0 AND NOT THE INTERVAL. The timer is only SET to the
// interval by a spawn that lands. A due timer that finds no room is left
// where it stands, and `specs/world.md` ("Timers") holds a timer at 0 —
// "a timer at `0` stays due on every tick until it is set again" — so 120
// ticks of a full field leave it at exactly 0, ready for the first tick with
// room. A build that sets the interval anyway reads 1.0 here and delays its
// next spawn by a second when the field clears.
//
// THE DRIVE. The isolated world with exactly the cap's 20 moths posed alive,
// the clock in window 0, the timer at 0, and `spawning` alone on, for 120
// ticks — two whole intervals of that window, so a build that spawns on the
// interval regardless of the cap lands two enemies inside the drive.
// `enemyMotion`, `enemyContact`, and `despawning` are off, so the 20 stay
// exactly 20 for reasons that have nothing to do with the director.
//
// THE TOLERANCE. None on the count. `REAL_EPS` on the timer, a real the
// specification fixes at exactly 0.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { REAL_EPS, SPAWN_WINDOWS, TICK_HZ, ticksOf } from "../constants";
import {
  captureStill,
  createHarness,
  enable,
  isolate,
  type Harness,
} from "../harness";
import { driveArrivals, fillCommons, poseWindow } from "./spawns";

/** Window 0's cap, and two of its intervals in ticks. */
const CAP = SPAWN_WINDOWS[0].cap;
const TICKS = 2 * ticksOf(SPAWN_WINDOWS[0].interval);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("lands no window spawn across 120 ticks with 20 commons alive, and rests the timer at 0", async () => {
  isolate(h);
  fillCommons(h, CAP);
  poseWindow(h, 0);
  enable(h, "spawning");
  assertEqual(
    h.snapshot().run.aliveCommons,
    CAP,
    `aliveCommons with ${CAP} moths posed alive`,
  );

  const drive = await driveArrivals(h, TICKS);
  captureStill(h, "capped");

  assertEqual(
    drive.arrivals.length,
    0,
    `the window spawns that landed over ${TICKS} ticks with the cap of ${CAP} met`,
  );
  assertEqual(
    drive.snapshot.run.enemies.length,
    CAP,
    `the enemies on the field after ${TICKS} ticks`,
  );
  assertNear(
    drive.snapshot.run.spawnTimer,
    0,
    REAL_EPS,
    `spawnTimer after ${TICKS} ticks held by the cap`,
  );
  assertEqual(
    drive.snapshot.run.spawnWindow,
    0,
    `the window index after ${TICKS} ticks, which stays 0 for ${TICK_HZ * 30} of them`,
  );
});
