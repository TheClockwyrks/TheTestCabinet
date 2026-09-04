// instrumentation/snapshot-resting-values — the fields a screen does not use
// report their resting values.
//
// `specs/instrumentation.md` § Snapshot shape: "The shape is fixed and every
// field is present whatever the screen. […] A field the current screen does not
// use reports the value it is holding rather than going missing, and the table
// below gives the value each rests at." The table is what is asserted here:
// `pendingNode` `null`, `historyDepth` `0`, the pointer's six fields at
// `{ x: 0, y: 0, down: false, pressX: 0, pressY: 0, dragging: false }`, `pick`
// at `{ node: null, member: null }`, `checkResult` `null`, and `run` the idle
// placeholder.
//
// The world is the one a `reset` stands up — "Returns the game to its title
// state" — and nothing else is posed, because every one of these fields is about
// what a screen that uses none of them reports. The reading is taken at the call,
// before any frame runs: the table says `pointer.x` and `pointer.y` are `0` on a
// reset and that "a `reset` shows in it only until the next update", so the frame
// that renders the still is driven after the snapshot rather than before it.
//
// The idle placeholder is `specs/state.md`'s: "phase `idle`, no cause, a zero
// tick, step index, and speed index, no live step, the four axes at the run-start
// posture `specs/program.md` fixes with no command and zero rate, a zero pivot, a
// bob at the origin with zero velocity, no attachment, and an empty load, force,
// and broken list."

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertLength,
  assertNull,
} from "../assert";
import { HOIST_START } from "../constants";
import { createHarness, type AxisName, type Harness } from "../harness";

/** The run-start posture `specs/program.md` fixes, per axis. */
const START_POSTURE: Readonly<Record<AxisName, number>> = {
  slew: 0,
  trolley: 0,
  hoist: HOIST_START,
  grip: 0,
};

const ORIGIN = { x: 0, y: 0, z: 0 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reports every resting value the table gives on the title screen", async () => {
  await h.debug.reset();
  const s = await h.snapshot();

  await h.advance(1);
  await h.capture("state", "The driven state this point decides");

  assertEqual(
    s.screen,
    "title",
    "the screen a reset leaves, which is the screen these values rest on",
  );

  assertNull(s.pendingNode, "pendingNode, until a first node is held");
  assertEqual(
    s.historyDepth,
    0,
    "historyDepth on a site opened and not edited",
  );
  assertDeepEqual(
    s.pointer,
    { x: 0, y: 0, down: false, pressX: 0, pressY: 0, dragging: false },
    "the pointer's six fields before the pointer has been used",
  );
  assertDeepEqual(
    s.pick,
    { node: null, member: null },
    "pick on every screen but build",
  );
  assertNull(s.checkResult, "checkResult while no check result is showing");

  const { run } = s;
  assertEqual(run.phase, "idle", "the idle placeholder's phase");
  assertNull(run.cause, "the idle placeholder's cause");
  assertEqual(run.tick, 0, "the idle placeholder's tick");
  assertEqual(run.time, 0, "the idle placeholder's run clock");
  assertEqual(run.speedIndex, 0, "the idle placeholder's speed index");
  assertEqual(run.stepIndex, 0, "the idle placeholder's step index");
  assertEqual(run.stepLive, false, "the idle placeholder's live step");
  for (const axis of ["slew", "trolley", "hoist", "grip"] as const) {
    const view = run.axes[axis];
    assertEqual(
      view.value,
      START_POSTURE[axis],
      `the idle placeholder's ${axis} value, the run-start posture`,
    );
    assertEqual(view.rate, 0, `the idle placeholder's ${axis} rate`);
    assertNull(view.command, `the idle placeholder's ${axis} command`);
  }
  assertDeepEqual(run.pivot, ORIGIN, "the idle placeholder's pivot");
  assertDeepEqual(run.bob.pos, ORIGIN, "the idle placeholder's bob position");
  assertDeepEqual(run.bob.vel, ORIGIN, "the idle placeholder's bob velocity");
  assertNull(run.attached, "the idle placeholder's attachment");
  assertLength(run.loads, 0, "the idle placeholder's load entries");
  assertLength(run.forces, 0, "the idle placeholder's force entries");
  assertLength(run.broken, 0, "the idle placeholder's broken list");
});
