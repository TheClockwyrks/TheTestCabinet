// audio/collapse-cue-on-no-other-cause — the collapse cue is bound to two causes.
//
// specs/ui.md § Audio, the `collapse` row: the cue plays when "a run fails as
// `collapse` or `ring-overload`". Those two are the crane coming down; the other
// eight causes specs/statics.md collects are not, and a run that ends on one of
// them plays the `fail` cue and no crash. A build that plays the crash on every
// failure tells the player the crane fell when a cable snapped, when a load
// touched the ground, and when a tape simply ran out with a load still in the
// yard.
//
// THREE CAUSES ARE POSED, chosen so none of them can be confused with a structural
// failure and so they reach the verdict at three different stages of the tick
// pipeline specs/program.md fixes:
//
//   - `cable-snap`, at stage 4 (rigging), which "the later stages of that tick do
//     not run" past — so the solves never get a say and the crane is standing
//     when the run ends;
//   - `load-struck-ground`, at stage 5 (collisions), for the same reason;
//   - `loads-unplaced`, at stage 1, the tick that "finds no live step and no step
//     left to take" with a load still waiting, which "runs none of the stages
//     below" at all.
//
// EACH IS POSED FROM ITS OWN ISOLATED WORLD: the site is opened afresh — which
// puts the run back to its idle placeholder and restores the yard — the yard and
// the tape are cleared, and exactly one load and the tape this cause needs are
// posed back. The `run-start` cue is drained before the failing tick in each, so
// what is read is that tick's own sounds.
//
// THE CRANE IS POSED ONCE AND STANDS FOR ALL THREE. `specs/state.md`: opening a
// site "keeps that site's stored structure and tape", so re-opening site one
// between the three scenarios returns the run to idle and the yard to the site's
// own without touching what is built. The crane is the same in all three — the
// minimal one, which none of these three causes is about — and building it three
// times would only be the same twenty-one edits made twice more.
//
// THE CAUSE IS READ BACK EACH TIME, because the silence of the crash only means
// anything against a run that failed for the cause this check named: a run that
// ended as `collapse` would be the cue's own event.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import {
  GRAVITY,
  GRIP_MAX_RATE,
  HOIST_CABLE_CAP,
  HOIST_START,
  HOOK_MASS,
  LOAD_CLASS_DIMENSIONS,
  SLEW_MAX_RATE,
} from "../constants";
import {
  addOneLoad,
  clearAll,
  createHarness,
  openSite,
  poseTape,
  runTicks,
  standMinimalCrane,
  startRun,
  type FailCause,
  type Harness,
  type TapeStepSpec,
} from "../harness";

/** Site 1, First Lift. */
const SITE = 0;

/** The minimal crane's pivot at the run-start posture: the track origin. */
const PIVOT = { x: 0, y: 4, z: 0 };

/** Where the hook hangs at the run's start: the pivot minus `(0, L, 0)`. */
const HOOK = { x: PIVOT.x, y: PIVOT.y - HOIST_START, z: PIVOT.z, yaw: 0 };

/** A bob a tenth past the cap: `3300` of tension hanging at rest. */
const SNAPPING_BOB = HOIST_CABLE_CAP / GRAVITY + 30;

/** A move that keeps the run running and loads nothing. */
const HOLD: TapeStepSpec = {
  kind: "move",
  commands: [{ axis: "grip", target: 100_000, rate: GRIP_MAX_RATE }],
};

/** A move whose target is the axis's value: one tick, and nothing moves. */
const NOOP: TapeStepSpec = {
  kind: "move",
  commands: [{ axis: "slew", target: 0, rate: SLEW_MAX_RATE }],
};

/** Where a load waits when it is meant to stay in the yard, unreachable. */
const AWAY = { x: 10, y: 2, z: 0, yaw: 0 };

/**
 * A cable length that hangs the crate's box below the ground.
 *
 * specs/statics.md § Collisions: an attached load "whose box dips below the
 * ground, its lift point's `y` minus its class height falling below `0`" ends the
 * run. The bob hangs `L` below the pivot, so a length of `3` puts the crate's
 * lift point at `y = 1`, a full unit of its `2`-unit height under the yard
 * floor — and well inside `HOIST_MIN` (`1`) and `HOIST_MAX` (`40`).
 */
const SUNK_HOIST = 3;

/**
 * Empty the yard and the tape of a site that has just been re-opened, leaving
 * what is built alone.
 *
 * `clearAll` would take the crane with them, and the crane is what every one of
 * these three scenarios shares. Opening a site restores its own loads and
 * obstacles and keeps its stored tape (`specs/state.md`), so both go, and the
 * tape poses apply on the program screen alone (`specs/instrumentation.md`).
 */
async function clearYardAndTape(harness: Harness): Promise<void> {
  await harness.debug.clearLoads();
  await harness.debug.clearObstacles();
  await harness.debug.setScreen("program");
  await harness.debug.clearProgram();
  await harness.debug.setScreen("build");
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("plays no collapse cue on a failure that is not a collapse", async () => {
  /** The sounds each failing tick played, against the cause it ended on. */
  const failures: { cause: FailCause | null; sounds: string[] }[] = [];

  /* ---- cable-snap: the rigging stage, before any solve ------------------- */

  await openSite(h, SITE);
  await clearAll(h);
  await standMinimalCrane(h);
  await addOneLoad(h, "crate", SNAPPING_BOB - HOOK_MASS, HOOK, HOOK);
  await poseTape(h, [HOLD]);
  await startRun(h);
  await runTicks(h, 2);
  await h.cues();
  await h.debug.setLoadPhase(0, "attached");
  const snapped = await runTicks(h, 1);
  failures.push({ cause: snapped.run.cause, sounds: await h.cues() });
  assertEqual(
    snapped.run.cause,
    "cable-snap",
    `the cause a bob of ${SNAPPING_BOB} hanging at rest ends the run with, ` +
      `${SNAPPING_BOB * GRAVITY} of tension against a HOIST_CABLE_CAP of ` +
      `${HOIST_CABLE_CAP} (specs/rigging.md)`,
  );

  /* ---- load-struck-ground: the collision stage --------------------------- */

  // The crane and the tape are the ones the scenario above left standing —
  // opening the site keeps both (`specs/state.md`) — so only the yard is cleared
  // and only the load this scenario is about is put back.
  await openSite(h, SITE);
  await h.debug.clearObstacles();
  await addOneLoad(h, "crate", 40, HOOK, HOOK);
  await startRun(h);
  await runTicks(h, 2);
  await h.cues();
  await h.debug.setLoadPhase(0, "attached");
  await h.debug.setAxis("hoist", SUNK_HOIST);
  const sunk = await runTicks(h, 1);
  failures.push({ cause: sunk.run.cause, sounds: await h.cues() });
  assertEqual(
    sunk.run.cause,
    "load-struck-ground",
    `the cause a crate hung ${SUNK_HOIST} below the pivot ends the run with: ` +
      `its lift point at y = ${PIVOT.y - SUNK_HOIST} less its class height ` +
      `of ${LOAD_CLASS_DIMENSIONS.crate.y} falls below 0 (specs/statics.md § ` +
      "Collisions)",
  );

  /* ---- loads-unplaced: the tape running out ----------------------------- */

  await openSite(h, SITE);
  await clearYardAndTape(h);
  await addOneLoad(h, "crate", 40, AWAY, AWAY);
  await poseTape(h, [NOOP]);
  await startRun(h);
  await runTicks(h, 1);
  await h.cues();
  const unplaced = await runTicks(h, 1);
  failures.push({ cause: unplaced.run.cause, sounds: await h.cues() });
  await h.capture("causes", "The three failures the collapse cue is silent on");
  assertEqual(
    unplaced.run.cause,
    "loads-unplaced",
    "the cause a tape that runs out with a load still waiting ends the run " +
      "with (specs/program.md § The tick pipeline)",
  );

  /* ---- The verdict ------------------------------------------------------- */

  const crashed = failures.filter((one) => one.sounds.includes("collapse"));
  assertLength(
    crashed,
    0,
    'the failures that played the `collapse` cue: it follows "a run fails ' +
      'as `collapse` or `ring-overload`" (specs/ui.md § Audio), and none of ' +
      "these three is either — the crane was standing when each of them " +
      `ended. The three ticks sounded ${JSON.stringify(failures)}`,
  );
});
