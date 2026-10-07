// instrumentation/reset-leaves-the-clock-switch — a reset inside a stepped
// scenario leaves the game where the check's own clock put it.
//
// THE RULE. `specs/instrumentation.md`, Session, on `reset`: "Whether the frame
// loop advances the simulation is untouched too, so a `reset` inside a stepped
// scenario leaves the game off the wall clock." The snapshot reports that switch
// as `autoStep`, and `reset` "Restores every declared field of the game's state
// to its title-screen value: the title screen with its first menu item
// highlighted... no run... `simTime` `0`" — a list the switch is deliberately
// not on, exactly as `muted` is not: "`muted` is untouched; the runtime owns
// muting."
//
// THE SAME READING UNDER EITHER ENGINE. There the clock "belong[s] to the
// {{engine}} engine, and the surface carries no operation for [it]", so there is
// no switch for a reset to touch and `autoStep` is not a field of the snapshot.
// Both spellings answer one question, and it is the question a scenario cares
// about: after the reset, is the game still held, so that the frames the check
// drives are the whole of the time that passes?
//
// THE CONFIGURATION. A stepped scenario: a posed challenge, one arm turning
// under `rotate-cw`, and a whole cycle driven by the harness's own clock. Then
// `reset`, and then a second run posed WITHOUT resetting again — the operations
// spelled out one by one, none of which advances a frame — and exactly two
// cycles of game time driven.
//
// THE VERDICT. The reset put the game back on the title with no run and
// `simTime` `0`, it did not report the frame-loop switch as ON, and the two
// cycles driven afterwards are the whole of the time that passed: `sim.cycle` is
// `2`, `sim.fraction` is back at a boundary, and `simTime` is exactly the two
// cycles' worth of game time. A build whose reset handed the game back to the
// wall clock runs on between these calls and lands nowhere near.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertNear,
  assertNotEqual,
  assertNotNull,
  assertNull,
} from "../assert";
import { FRACTION_TOLERANCE } from "../constants";
import { BARE } from "../fixtures";
import { armPart, solution } from "../formats";
import {
  advanceCycles,
  captureReplay,
  createHarness,
  openBareRun,
  secondsPerCycle,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves the simulation held, so only the frames driven move it", async () => {
  await openBareRun(h, {
    challenge: BARE,
    machine: solution([armPart("arm", 0, 0, 0, 1, ["rotate-cw"])]),
  });
  await advanceCycles(h, 1);
  const stepped = await h.snapshot();

  await h.debug.reset();
  const restored = await h.snapshot();

  // The same opener `openBareRun` spells out, minus the reset: this check is
  // about what the reset above left behind, so nothing may reset again.
  await h.debug.loadChallenge(BARE);
  await h.debug.clearMachine();
  await h.debug.loadSolution(
    solution([armPart("arm", 0, 0, 0, 1, ["rotate-cw", "rotate-ccw"])]),
  );
  await h.debug.setCompletion(false);
  await h.debug.startRun();
  await h.debug.clearMotes();

  await captureReplay(h, "stepped", () => advanceCycles(h, 2));
  const driven = await h.snapshot();

  assertEqual(
    stepped.sim?.cycle,
    1,
    "the scenario really was stepped: one driven cycle ran",
  );
  assertNotEqual(
    restored.autoStep,
    true,
    "reset leaves the frame-loop switch untouched: off in a stepped scenario, and absent under an engine that owns the clock",
  );
  assertEqual(
    restored.screen,
    "title",
    "reset restores every declared field to its title-screen value",
  );
  assertNull(restored.sim, "reset leaves no run");
  assertNear(
    restored.simTime,
    0,
    FRACTION_TOLERANCE,
    "reset restores simTime to 0: nothing ran between the reset and the read",
  );

  const sim = driven.sim;
  assertNotNull(sim, "the second run is live");
  assertEqual(
    sim?.cycle,
    2,
    "exactly the two cycles driven ran, so nothing advanced the run between the calls",
  );
  assertNear(
    sim?.fraction ?? -1,
    0,
    FRACTION_TOLERANCE,
    "two whole cycles of game time land the run back on a boundary",
  );
  assertNear(
    driven.simTime,
    2 * secondsPerCycle(sim?.speed ?? 0),
    FRACTION_TOLERANCE,
    "simTime accumulated the driven frames' delta time and nothing else",
  );
});
