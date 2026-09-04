// Wick — instrumentation/switches-resume-without-catch-up: with `spawning` off
// for 300 ticks in window 0 and then on, exactly one spawn lands when the held
// timer is next due rather than the five the window would have spawned.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/instrumentation.md`, "The
// driver switches": "turning one back on resumes that faculty from the next
// tick, with no catching up for the ticks it missed." `specs/enemies.md`, "The
// spawn timer": a due timer spawns one enemy and is set to the window's
// interval, 1.0 s in window 0, so a second spawn cannot land within the next
// 59 ticks.
//
// THE DRIVE. An isolated run at tick 0 with the timer at 0, which is due; 300
// ticks with the switch off spawn nothing; the switch on: one enemy on the
// first tick, still one after 59 more.

import { afterEach, beforeEach, it } from "vitest";
import { assertLength } from "../assert";
import { SPAWN_WINDOWS, ticksOf } from "../constants";
import {
  advanceTicks,
  captureReplay,
  createHarness,
  enable,
  isolate,
  type Harness,
} from "../harness";

const HELD_TICKS = 300;
const INTERVAL_TICKS = ticksOf(SPAWN_WINDOWS[0].interval);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("lands one spawn on resuming and none of the missed ones", async () => {
  isolate(h);
  const { held, first, later } = await captureReplay(h, "resumed", async () => {
    const held = await advanceTicks(h, HELD_TICKS);
    enable(h, "spawning");
    const first = await advanceTicks(h, 1);
    const later = await advanceTicks(h, INTERVAL_TICKS - 1);
    return { held, first, later };
  });

  assertLength(
    held.run.enemies,
    0,
    `enemies over ${HELD_TICKS} ticks with spawning off`,
  );
  assertLength(
    first.run.enemies,
    1,
    "enemies on the first tick with spawning on",
  );
  assertLength(
    later.run.enemies,
    1,
    `enemies ${INTERVAL_TICKS - 1} ticks later, short of the next interval`,
  );
});
