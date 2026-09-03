// tape/run-start-step-index — a run starts on step 0, with that step not yet
// live.
//
// `specs/state.md` § What a run's start leaves gives the row in full: the step
// index and whether that step is live are "`0`, and not live: the first tick is
// what takes the first step". `specs/program.md` says the same from the
// pipeline's side — a tick's tape stage is where "this tick takes the next one".
//
// BOTH READINGS ARE TAKEN, either side of one tick, because `stepLive` false is
// only meaningful beside a `stepLive` that turns true: a build that reported the
// flag as false throughout would pass the first reading and fail the second, and
// a build that took its first step while starting reads true at the first. The
// harness holds the game off its own clock, so the single tick between the two
// readings is the only thing that has happened.
//
// The tape carries two steps so the run is nowhere near running out at either
// reading, and its first is a move long enough to still be live a tick in — a
// move step "is live from the tick that issues its commands until the tick that
// finds every one of its axes arrived". The world holds nothing else.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertTrue } from "../assert";
import { GRIP_MAX_RATE, HOIST_MAX_RATE } from "../constants";
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

/** Two steps, the first long enough to still be live one tick in. */
const TAPE: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [{ axis: "hoist", target: 6, rate: HOIST_MAX_RATE }],
  },
  {
    kind: "move",
    commands: [{ axis: "grip", target: 90, rate: GRIP_MAX_RATE }],
  },
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("stands on step 0 unlive at the start and live after one tick", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await standMinimalCrane(h);
  await poseTape(h, TAPE);

  const started = await startRun(h);
  const first = await runTicks(h, 1);

  await h.capture("state", "The step the run's first tick took");

  assertEqual(
    started.run.stepIndex,
    0,
    "run.stepIndex at the moment the run starts (specs/state.md)",
  );
  assertTrue(
    !started.run.stepLive,
    "whether that step is live at the moment the run starts: it is not, " +
      "since the first tick is what takes it (specs/state.md)",
  );
  assertTrue(
    first.run.stepLive,
    "whether step 0 is live once the first tick has taken it and its axis " +
      "has not arrived (specs/state.md)",
  );
});
