// director/cap-room-spawns-at-once — the held spawn lands the moment there is
// room.
//
// THE SPEC LINE. `specs/enemies.md`, "The spawn timer": "When the cap is full
// the timer rests at `0`, and the next spawn lands on the first tick that has
// room." `specs/world.md` ("Timers") is why there is no wait: "a timer at `0`
// stays due on every tick until it is set again", so the tick after the field
// opens up finds the timer due and `aliveCommons` under the cap on the same
// tick. Row 0 of `SPAWN_WINDOWS` caps window 0 at `20`.
//
// WHAT SEPARATES A CONFORMANT BUILD. One that restarts its timer when the cap
// blocks a spawn waits a whole interval — 60 ticks in window 0 — after the
// field clears. This check gives it one tick.
//
// HOW THE ROOM IS MADE. `removeEnemy`, which "Removes enemy `id`. Nothing
// drops, nothing counts as a kill, and no cue plays"
// (`specs/instrumentation.md`) — so the field opens up without a death, and
// nothing but the count changes.
//
// THE DRIVE. The isolated world with the cap's 20 moths alive, the clock in
// window 0, the timer at 0 and `spawning` alone on. Sixty ticks first, so the
// timer is resting at 0 rather than freshly posed there and the check is about
// the cap rather than about the pose; then one moth removed, then one tick.
//
// THE TOLERANCE. None: a spawn arrived on that tick or it did not.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { SPAWN_WINDOWS, ticksOf } from "../constants";
import {
  captureStill,
  createHarness,
  enable,
  isolate,
  type Harness,
} from "../harness";
import { driveArrivals, fillCommons, poseWindow } from "./spawns";

/** Window 0's cap, and one of its intervals in ticks. */
const CAP = SPAWN_WINDOWS[0].cap;
const RESTING_TICKS = ticksOf(SPAWN_WINDOWS[0].interval);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("spawns on the very first tick after a moth is removed from a full field", async () => {
  isolate(h);
  const posed = fillCommons(h, CAP);
  poseWindow(h, 0);
  enable(h, "spawning");

  const held = await driveArrivals(h, RESTING_TICKS);
  h.debug.removeEnemy(posed[0]);
  const after = await driveArrivals(h, 1);
  captureStill(h, "room");

  assertEqual(
    held.arrivals.length,
    0,
    `the window spawns that landed over ${RESTING_TICKS} ticks with the cap of ${CAP} met`,
  );
  assertEqual(
    after.arrivals.length,
    1,
    "the window spawns that landed on the first tick with room under the cap",
  );
  assertEqual(
    after.snapshot.run.aliveCommons,
    CAP,
    "aliveCommons after the spawn that filled the field again",
  );
});
