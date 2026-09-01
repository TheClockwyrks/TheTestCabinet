// instrumentation/reset-restores-fields — from a thoroughly disturbed run,
// `reset()` returns the game to title with menuIndex 0, the idle run of
// specs/state.md, and the accumulator and simTime at 0.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md, `reset`: "Restores
// every declared field of the game's state to its title-screen value: the
// `title` screen with `menuIndex` `0`, the idle run of `specs/state.md`, the
// accumulator and `simTime` at `0`, and every driver switch on". The idle run
// is the table under specs/state.md, "The idle run", restated as `IDLE_RUN` in
// `helpers.ts` with the derived fields the snapshot adds to it.
//
// THE DISTURBANCE. The busy night poses every region a lazy reset could leave
// behind, a partial frame leaves the accumulator above 0 and simTime above
// 0, and a tick has the world carrying its own hits entry. Read without a
// frame: the values are restored "once the call returns", and a frame would
// move simTime again.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { assertIdleRun, poseBusyNight } from "./helpers";

/** A frame of 25 ms on playing: one tick and a remainder in the accumulator. */
const PARTIAL_FRAME_SECONDS = 0.025;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("restores the title state and the idle run from a disturbed run", async () => {
  poseBusyNight(h);
  const disturbed = await h.frameOf(PARTIAL_FRAME_SECONDS);
  assertGreaterThan(
    disturbed.accumulator,
    0,
    "the accumulator before the reset",
  );
  assertGreaterThan(disturbed.simTime, 0, "simTime before the reset");
  assertGreaterThan(
    disturbed.run.enemies.length,
    0,
    "the enemies before the reset",
  );

  h.reset();
  const s = h.snapshot();
  await h.tick(1);
  captureStill(h, "reset");

  assertEqual(s.screen, "title", "the screen a reset leaves");
  assertEqual(s.menuIndex, 0, "menuIndex after the reset");
  assertIdleRun(s.run, "run after the reset: the idle run");
  assertEqual(s.accumulator, 0, "the accumulator after the reset");
  assertEqual(s.simTime, 0, "simTime after the reset");
});
