// Wick — clock/sim-time-accounting: simTime accounts for every frame.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/instrumentation.md` ("A deterministic core"): "`simTime` rises by
//     every frame's delta time on every screen"; and "On every other screen a
//     frame ticks nothing and the accumulator holds `0`."
//   - `specs/state.md` (`WickState`): "`simTime`: accumulated simulation time,
//     in seconds. Every frame adds its delta time, whatever the screen, the
//     menus and the overlays included." And of `accumulator`: "It grows on
//     `playing` alone ... so it holds `0` on every other screen."
//   - `specs/ui.md` ("What advances on each screen"): "`simTime` accumulates
//     the frame's delta time on every frame, whatever the screen"; the table
//     gives `title`, `howto`, `levelup`, `chest`, `paused`, `fallen`, and
//     `dawn` as ticking "Nothing".
//
// WHAT IS READ. Two identities. On `playing`, after a mix of frames of assorted
// lengths, the ticks gained times TICK_DT plus the accumulator left waiting
// equals the simTime gained: every second delivered was either consumed as a
// tick or is still waiting. On each of the seven other screens, a mix of frames
// raises simTime by the sum of their deltas while the tick stands still and
// the accumulator holds 0.
//
// WHY THE NIGHT IS POSED AS IT IS. The accounting is about the clock alone, so
// the `playing` run is the empty isolated night; each other screen is entered
// through the surface's own transition, the two overlays through the tick that
// opens each, so the frames measured are frames on exactly that screen.
//
// TOLERANCE. `FIGURE_TOLERANCE` (1e-9) on each identity: a sum of a handful of
// decimal figures formed in floating point.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertWithin } from "../assert";
import { FIGURE_TOLERANCE, TICK_DT, TICK_EPSILON } from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  openChest,
  openLevelUp,
  poseScene,
  type Harness,
  type Screen,
} from "../harness";

/**
 * The frames delivered, in seconds: several ticks in one, less than a tick,
 * exactly a tick, one tick and a remainder, and a sliver. Their sum is what
 * simTime must gain wherever they are delivered.
 */
const FRAMES = [0.04, 0.01, TICK_DT, 0.025, 0.003] as const;
const FRAMES_TOTAL = FRAMES.reduce((sum, seconds) => sum + seconds, 0);

/** The screens on which a frame ticks nothing, each reached its own way. */
const OTHER_SCREENS: readonly Exclude<Screen, "playing">[] = [
  "title",
  "howto",
  "paused",
  "fallen",
  "dawn",
  "levelup",
  "chest",
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

/** Enter `screen` from a fresh reset, by its own transition. */
async function enter(screen: Exclude<Screen, "playing">): Promise<void> {
  if (screen === "levelup") {
    isolate(h);
    await openLevelUp(h);
  } else if (screen === "chest") {
    isolate(h);
    await openChest(h);
  } else {
    poseScene(h, screen);
  }
}

it("accounts every frame's delta as ticks, remainder, or simTime alone", async () => {
  const posed = isolate(h);
  for (const seconds of FRAMES) await h.frameOf(seconds);
  const played = h.snapshot();
  captureStill(h, "accounted");

  assertWithin(
    (played.run.tick - posed.run.tick) * TICK_DT +
      played.accumulator -
      posed.accumulator,
    played.simTime - posed.simTime,
    FIGURE_TOLERANCE,
    "ticks × TICK_DT + accumulator against the simTime gained on playing",
  );
  assertWithin(
    played.simTime - posed.simTime,
    FRAMES_TOTAL,
    FIGURE_TOLERANCE,
    "simTime gained on playing against the frames delivered",
  );

  for (const screen of OTHER_SCREENS) {
    await enter(screen);
    const before = h.snapshot();
    assertEqual(before.screen, screen, "the screen entered");
    for (const seconds of FRAMES) await h.frameOf(seconds);
    const after = h.snapshot();

    assertEqual(after.screen, screen, `screen after frames on ${screen}`);
    assertEqual(after.run.tick, before.run.tick, `run.tick on ${screen}`);
    assertWithin(
      after.accumulator,
      0,
      TICK_EPSILON,
      `accumulator on ${screen}`,
    );
    assertWithin(
      after.simTime - before.simTime,
      FRAMES_TOTAL,
      FIGURE_TOLERANCE,
      `simTime gained on ${screen}`,
    );
  }
});
