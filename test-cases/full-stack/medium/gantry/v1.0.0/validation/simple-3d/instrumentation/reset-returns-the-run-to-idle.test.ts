// instrumentation/reset-returns-the-run-to-idle — a reset leaves the run at its
// idle placeholder, whatever run was in progress or last ended.
//
// `specs/instrumentation.md` § The run and the screens ends its list of what a
// reset restores with "no check result showing, an idle run, and `simTime` at
// `0`". `specs/state.md` fixes what an idle run is, field by field: "The idle
// placeholder is phase `idle`, no cause, a zero tick, step index, and speed
// index, no live step, the four axes at the run-start posture `specs/program.md`
// fixes with no command and zero rate, a zero pivot, a bob at the origin with
// zero velocity, no attachment, and an empty load, force, and broken list."
//
// THE RUN THE RESET HAS TO UNDO IS ONE THAT ENDED WITH A CAUSE, because a failed
// run is the state furthest from the placeholder: `specs/state.md` says "A run
// that ends is left as it ended until the next one starts: its verdict, its
// cause, its clock, and its broken list stay readable". The tape is a single
// `attach` over an empty yard, which `specs/rigging.md` ends as `attach-missed`
// — "With no candidate, the run ends as `attach-missed`" — so the failure comes
// from the real simulation on the first tick rather than from a pose, and it
// needs no load, no obstacle and no overloaded crane to arrange.
//
// The minimal crane is here only so the run may legally start; nothing about this
// requirement concerns the crane.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertLength,
  assertNotEqual,
  assertNull,
  assertTrue,
} from "../assert";
import { HOIST_START } from "../constants";
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

/** One action over an empty yard: the run ends as `attach-missed`. */
const TAPE: readonly TapeStepSpec[] = [{ kind: "action", action: "attach" }];

/** Ticks to wait for the verdict; the action executes on the run's first. */
const CAP = 120;

/** The four axes, at the run-start posture `specs/program.md` fixes. */
const START_POSTURE = { slew: 0, trolley: 0, hoist: HOIST_START, grip: 0 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("returns the run to its idle placeholder", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await standMinimalCrane(h);
  await poseTape(h, TAPE);
  await startRun(h);
  const ended = await runUntil(
    h,
    (s) => s.run.phase !== "running",
    CAP,
    "the run to reach a verdict",
  );
  assertNotEqual(ended.run.phase, "idle", "the run the reset has to undo");
  assertNotEqual(ended.run.cause, null, "the cause the ended run carries");

  await h.debug.reset();
  const { run } = await h.snapshot();
  await h.advance(1);
  await h.capture("run", "The run a reset puts back");

  assertEqual(run.phase, "idle", "the idle placeholder's phase");
  assertNull(run.cause, "the idle placeholder's cause");
  assertEqual(run.tick, 0, "the idle placeholder's tick");
  assertEqual(run.stepIndex, 0, "the idle placeholder's step index");
  assertEqual(run.speedIndex, 0, "the idle placeholder's speed index");
  assertTrue(!run.stepLive, "the idle placeholder has no live step");
  for (const [axis, value] of Object.entries(START_POSTURE)) {
    const view = run.axes[axis as keyof typeof START_POSTURE];
    assertEqual(view.value, value, `the idle placeholder's ${axis} value`);
    assertEqual(view.rate, 0, `the idle placeholder's ${axis} rate`);
    assertNull(view.command, `the idle placeholder's ${axis} command`);
  }
  assertEqual(run.pivot.x, 0, "the idle placeholder's pivot");
  assertEqual(run.pivot.y, 0, "the idle placeholder's pivot");
  assertEqual(run.pivot.z, 0, "the idle placeholder's pivot");
  assertEqual(run.bob.pos.x, 0, "the idle placeholder's bob position");
  assertEqual(run.bob.pos.y, 0, "the idle placeholder's bob position");
  assertEqual(run.bob.pos.z, 0, "the idle placeholder's bob position");
  assertEqual(run.bob.vel.x, 0, "the idle placeholder's bob velocity");
  assertEqual(run.bob.vel.y, 0, "the idle placeholder's bob velocity");
  assertEqual(run.bob.vel.z, 0, "the idle placeholder's bob velocity");
  assertNull(run.attached, "the idle placeholder's attachment");
  assertLength(run.loads, 0, "the idle placeholder's load entries");
  assertLength(run.forces, 0, "the idle placeholder's force entries");
  assertLength(run.broken, 0, "the idle placeholder's broken list");
});
