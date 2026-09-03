// audio/complete-cue — the tick a run clears the site sounds the complete cue.
//
// specs/ui.md § Audio: "| `complete` | a run clears the site |".
// specs/program.md fixes which tick that is: "A tick that finds no live step and
// no step left to take is the tick the run ends on: cleared if every load is
// `placed`, otherwise failed as `loads-unplaced`."
//
// THE CLEAR IS REACHED BY THE REAL SIMULATION, not by a posed screen: a
// `setScreen("results")` would decide nothing about what clearing sounds. So the
// yard is emptied — no loads, no obstacles — the smallest crane that stands is
// built, and the tape is one move whose target is the axis the run already
// starts at. specs/program.md makes that step complete on the tick it is issued
// ("A command whose target is the axis's current value therefore has `s` of `0`
// … so the command is done on the tick it is issued"), so the run is two ticks
// long: the first takes the step, the second finds nothing left and ends. A yard
// holding no load has every load `placed` vacuously, so that end is a clear —
// with no lift, no set-down and no obstacle to fail on the way there.
//
// The queue is drained on the tick before the last, so what is read back is the
// ending tick's own sound and not a cue from anywhere earlier in the run.

import { afterEach, beforeEach, it } from "vitest";
import { assertContains, assertEqual } from "../assert";
import { SLEW_MAX_RATE } from "../constants";
import {
  clearAll,
  createHarness,
  openSite,
  poseTape,
  runTicks,
  standMinimalCrane,
  startRun,
  type Harness,
  type TapeStepSpec,
} from "../harness";

/** The site this runs on; every site clears the same way. */
const SITE = 0;

/** One move to where the slew already stands: taken and done on one tick. */
const TAPE: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [{ axis: "slew", target: 0, rate: SLEW_MAX_RATE }],
  },
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("sounds the complete cue on the tick a run clears the site", async () => {
  await openSite(h, SITE);
  await clearAll(h);
  await standMinimalCrane(h);
  await poseTape(h, TAPE);

  await startRun(h);
  const taken = await runTicks(h, 1);
  assertEqual(
    taken.run.phase,
    "running",
    "the run after the tick that took its one step: the step is done on the " +
      "tick it is issued, and the run ends on the tick after (specs/program.md)",
  );

  await h.cues(); // everything sounded up to the tick before the last, drained
  const ended = await runTicks(h, 1);
  const played = await h.cues();
  await h.capture("state", "the screen the run reached when it cleared");

  assertEqual(
    ended.run.phase,
    "cleared",
    "the run to end cleared, its tape spent with no load left unplaced " +
      "(specs/program.md)",
  );
  assertContains(
    played,
    "complete",
    "the cues the ending tick sounded: `complete` plays when a run clears " +
      "the site (specs/ui.md § Audio)",
  );
});
