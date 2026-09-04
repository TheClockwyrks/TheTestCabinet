// director/spawn-interval — spawns land one interval apart and not between.
//
// THE SPEC LINE. `specs/enemies.md`, "The spawn timer", sets `spawnTimer` to
// the window's `interval` on the tick a spawn lands, and `specs/world.md`
// ("Timers") turns that into ticks: "a timer set to `s` seconds is due
// `round(s × TICK_HZ)` ticks after the tick it was set on. ... An interval of
// `s` seconds anywhere in this specification is likewise
// `round(s × TICK_HZ)` ticks." Row 0 of `SPAWN_WINDOWS` gives window 0 an
// interval of `1.00` seconds, so `round(1.0 × 60)` is 60 ticks, and a cap of
// `20`, which five spawns over an empty field never meet.
//
// WHAT THE FIRST SPAWN TICK IS. Tick 1: the run's timer starts at 0 and is due
// on the first tick, as the fresh-run item decides. The ticks a spawn is
// expected on are therefore 1, 61, 121, 181, and 241 — the check names all
// five, so a build that spawns early, late, or twice inside an interval fails
// on the tick it deviated.
//
// THE DRIVE. The isolated world with `spawning` alone on, stepped one tick at
// a time for 241 ticks so that every arrival's tick is known exactly. Nothing
// is cleared away as it arrives: five commons is far under window 0's cap of
// 20, so the cap plays no part in what the timer does here.
//
// THE TOLERANCE. None. A tick is a whole number, and the specification fixes
// which one each spawn lands on.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual } from "../assert";
import { SPAWN_WINDOWS, ticksOf } from "../constants";
import {
  captureReplay,
  createHarness,
  enable,
  isolate,
  type Harness,
} from "../harness";
import { driveArrivals, poseWindow } from "./spawns";

/** Window 0's interval, in whole ticks: `round(1.0 × 60)`. */
const INTERVAL = ticksOf(SPAWN_WINDOWS[0].interval);

/** The spawns read, and the ticks each is due on. */
const SPAWNS = 5;
const DUE_TICKS = Array.from({ length: SPAWNS }, (_, i) => 1 + i * INTERVAL);
const BUDGET_TICKS = DUE_TICKS[SPAWNS - 1];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("lands window 0's spawns 60 ticks apart and none between", async () => {
  isolate(h);
  poseWindow(h, 0);
  enable(h, "spawning");

  const drive = await captureReplay(h, "interval", () =>
    driveArrivals(h, BUDGET_TICKS),
  );

  assertDeepEqual(
    drive.arrivals.map((arrival) => arrival.tick),
    DUE_TICKS,
    `the ticks the director spawned on over the first ${BUDGET_TICKS} ticks of window 0`,
  );
});
