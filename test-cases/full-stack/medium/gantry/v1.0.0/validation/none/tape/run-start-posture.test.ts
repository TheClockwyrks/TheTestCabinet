// tape/run-start-posture — every run begins from the same posture, whatever the
// run before it left.
//
// `specs/program.md` § The axes: "Every run starts from the same posture: `slew`
// `0`, the build pose; `trolley` `0`, the track origin; `hoist` `HOIST_START`
// (`2`); `grip` `0`." `specs/state.md` gives the rest of the reading in its
// run-start table: the four axes stand at "the run-start posture
// `specs/program.md` fixes, each axis stopped with no command".
//
// THE POSTURE IS READ OFF A SECOND RUN, NOT A FIRST. A build that never wrote the
// posture at all passes a first run, because the axes have not moved yet. So a run
// is started, driven until all four axes have carried well away from the posture,
// and aborted; the second run is what the reading is taken from. `specs/program.md`
// has the abort leave the structure, the tape and the loads untouched — "every run
// begins from the same authored state, and running is always repeatable" — so
// the second run is posed by nothing but the first one having happened.
//
// ALL FOUR AXES IN ONE MOVE, so the first run leaves none of them where it found
// it: the step carries one command per axis, which is what a move step is
// ("one or more commands, at most one per axis").
//
// The reading is taken with no tick driven, so it is what the START left rather
// than what a tick put back. The yard is empty: nothing here concerns a load.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotEqual, assertNull } from "../assert";
import {
  GRIP_MAX_RATE,
  HOIST_MAX_RATE,
  HOIST_START,
  SLEW_MAX_RATE,
  TICK_HZ,
  TROLLEY_MAX_RATE,
} from "../constants";
import {
  clearAll,
  createHarness,
  openSite,
  poseTape,
  runUntil,
  standMinimalCrane,
  startRun,
  type Harness,
  type TapeStepSpec,
} from "../harness";

/** The posture `specs/program.md` fixes, axis by axis. */
const POSTURE = { slew: 0, trolley: 0, hoist: HOIST_START, grip: 0 } as const;

/** One move that drives all four axes away from that posture. */
const TAPE: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [
      { axis: "slew", target: 20, rate: SLEW_MAX_RATE },
      { axis: "trolley", target: 2, rate: TROLLEY_MAX_RATE },
      { axis: "hoist", target: 4, rate: HOIST_MAX_RATE },
      { axis: "grip", target: 30, rate: GRIP_MAX_RATE },
    ],
  },
];

/** The slowest of the four covers its distance well inside this. */
const CAP = 10 * TICK_HZ;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("puts every axis back at the run-start posture when a second run begins", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await standMinimalCrane(h);
  await poseTape(h, TAPE);

  await startRun(h);
  const driven = await runUntil(
    h,
    (s) =>
      s.run.axes.slew.value !== POSTURE.slew &&
      s.run.axes.trolley.value !== POSTURE.trolley &&
      s.run.axes.hoist.value !== POSTURE.hoist &&
      s.run.axes.grip.value !== POSTURE.grip,
    CAP,
    "all four axes to carry away from the posture the run started at",
  );
  for (const axis of ["slew", "trolley", "hoist", "grip"] as const) {
    assertNotEqual(
      driven.run.axes[axis].value,
      POSTURE[axis],
      `the ${axis}'s value while the first run drove it, which is what the ` +
        "second run must not inherit",
    );
  }
  await h.debug.abortRun();

  const started = await startRun(h);
  await h.advance(1);
  await h.capture("state", "The driven state this point decides");

  for (const axis of ["slew", "trolley", "hoist", "grip"] as const) {
    assertEqual(
      started.run.axes[axis].value,
      POSTURE[axis],
      `the ${axis}'s value at a run's start (specs/program.md)`,
    );
    assertEqual(
      started.run.axes[axis].rate,
      0,
      `the ${axis}'s rate at a run's start: each axis is stopped ` +
        "(specs/state.md)",
    );
    assertNull(
      started.run.axes[axis].command,
      `the command live on the ${axis} at a run's start: there is none ` +
        "(specs/state.md)",
    );
  }
});
