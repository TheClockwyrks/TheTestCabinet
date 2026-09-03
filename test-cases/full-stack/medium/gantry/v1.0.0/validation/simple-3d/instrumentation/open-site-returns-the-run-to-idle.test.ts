// instrumentation/open-site-returns-the-run-to-idle — opening a site puts the
// idle placeholder back.
//
// `specs/state.md` § What a site opening does: opening a site "returns the run to
// its idle placeholder", and `specs/instrumentation.md` § The run and the screens
// binds `openSite` to that list — it "carries the effects `specs/state.md` states
// for opening a site". § Snapshot shape's resting-value table says the same from
// the reading's side: `run` is the idle placeholder "before a site's first run,
// and again whenever a site is opened, a run is aborted, or `reset` is called".
//
// The placeholder is `specs/state.md`'s: "phase `idle`, no cause, a zero tick,
// step index, and speed index, no live step, […] no attachment, and an empty load,
// force, and broken list."
//
// It must be read over a run that really ended, or an idle reading afterwards
// would say nothing — a run "that ends is left as it ended until the next one
// starts". The tape's one move commands the hoist past `HOIST_MAX` (`40`), which
// `specs/program.md` ends as `command-out-of-range` when the step starts, so the
// run's first tick reaches a verdict by the game's own rules with no load, no
// obstacle and no swing involved. The world is the minimal crane on an emptied
// yard and nothing else.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertLength,
  assertNotNull,
  assertNull,
} from "../assert";
import { HOIST_MAX, HOIST_MAX_RATE } from "../constants";
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

/** One move the run cannot take: the hoist target is outside the axis's range. */
const OUT_OF_RANGE_TAPE: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [{ axis: "hoist", target: HOIST_MAX + 10, rate: HOIST_MAX_RATE }],
  },
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("returns the run to its idle placeholder when a site is opened", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await standMinimalCrane(h);
  await poseTape(h, OUT_OF_RANGE_TAPE);
  await startRun(h);
  const failed = await runUntil(
    h,
    (s) => s.run.phase !== "running",
    5,
    "the run to end on its out-of-range hoist command",
  );
  assertEqual(
    failed.run.phase,
    "failed",
    "the verdict the out-of-range command reaches (specs/program.md)",
  );
  assertNotNull(
    failed.run.cause,
    "the cause the failed run carries, which is what an opening must take away",
  );

  await h.debug.openSite(1);
  const { run } = await h.snapshot();

  await h.advance(1);
  await h.capture("state", "The driven state this point decides");

  assertEqual(run.phase, "idle", "the phase a site opening leaves");
  assertNull(run.cause, "the cause a site opening leaves");
  assertEqual(run.tick, 0, "the tick a site opening leaves");
  assertEqual(run.time, 0, "the run clock a site opening leaves");
  assertEqual(run.stepIndex, 0, "the step index a site opening leaves");
  assertEqual(run.stepLive, false, "the live step a site opening leaves");
  assertNull(run.attached, "the attachment a site opening leaves");
  assertLength(run.loads, 0, "the load entries a site opening leaves");
  assertLength(run.forces, 0, "the force entries a site opening leaves");
  assertLength(run.broken, 0, "the broken list a site opening leaves");
});
