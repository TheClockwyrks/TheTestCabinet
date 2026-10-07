// audio/creak-not-on-the-first-tick — a run's first tick never creaks, however
// loaded the crane starts.
//
// specs/ui.md § Audio states the exemption inside the creak rule: a member's
// utilization reaching `CREAK_THRESHOLD` (`0.8`) "on a tick having been below it
// on the tick before" sounds the cue, "and no member creaks on a run's first
// tick". The first tick has no tick before it, so a build that reads its
// threshold crossing against a zero or an absent previous reading creaks the
// moment any run of a loaded crane begins — which is the mistake this decides.
//
// THE RUN STARTS ALREADY OVER THE THRESHOLD. A crate of `180` is hung on the
// hook with `setLoadPhase` before a single tick has run, which
// specs/instrumentation.md says "hangs that load on the hook exactly as a
// successful `attach` leaves it", and specs/instrumentation.md is equally clear
// that this is a precondition and not an outcome — "none of them reaches a
// verdict: the run's own rules decide clearing, breakage, and every failure on
// the ticks that follow". So the run's very first tick solves a crane whose
// worst utilization is already past `0.8`, which the check reads back off that
// tick's own forces before deciding anything.
//
// The load is light enough that the tension `(HOOK_MASS + 180) * GRAVITY`,
// `1850`, stays under `HOIST_CABLE_CAP` (`3000`) and no utilization passes `1`,
// so the first tick carries the loading and nothing else. The tape is one long
// `grip` move, the axis specs/rigging.md says "applies no force to anything".

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThanOrEqual, assertLength } from "../assert";
import {
  CREAK_THRESHOLD,
  GRAVITY,
  GRIP_MAX_RATE,
  HOIST_CABLE_CAP,
  HOIST_START,
  HOOK_MASS,
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
  type Harness,
  type TapeStepSpec,
} from "../harness";

/** The site this runs on; the crane and the load are the whole scenario. */
const SITE = 0;

/** The minimal crane's pivot at the run-start posture: the track origin. */
const PIVOT = { x: 0, y: 4, z: 0 } as const;

/** Where the run hangs the bare hook, and so where the load is put. */
const HOOK = {
  x: PIVOT.x,
  y: PIVOT.y - HOIST_START,
  z: PIVOT.z,
  yaw: 0,
} as const;

/**
 * Heavy enough for the first tick's worst utilization to be past
 * `CREAK_THRESHOLD`, light enough to leave it under `1` and the cable intact.
 */
const LOAD_MASS = 180;

/** A move that keeps the run alive and applies no force to the structure. */
const TAPE: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [{ axis: "grip", target: 100_000, rate: GRIP_MAX_RATE }],
  },
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("sounds no creak on a run's first tick, loaded past the threshold", async () => {
  await openSite(h, SITE);
  await clearAll(h);
  await standMinimalCrane(h);
  await addOneLoad(h, "crate", LOAD_MASS, HOOK, HOOK);
  await poseTape(h, TAPE);

  await startRun(h);
  await h.debug.setLoadPhase(0, "attached");
  await h.cues(); // the start's own `run-start`, drained
  const first = await runTicks(h, 1);
  const played = await h.cues();
  await h.capture("state", "the loaded crane on the run's first tick");

  assertEqual(first.run.tick, 1, "the tick the reading was taken on");
  assertEqual(
    first.run.phase,
    "running",
    `the run on its first tick: a cable tension of ` +
      `${(HOOK_MASS + LOAD_MASS) * GRAVITY} is under HOIST_CABLE_CAP ` +
      `(${HOIST_CABLE_CAP}) and no utilization passes 1 (specs/statics.md)`,
  );
  assertGreaterThanOrEqual(
    first.run.forces.reduce((high, one) => Math.max(high, one.utilization), 0),
    CREAK_THRESHOLD,
    `the worst utilization on the run's first tick, with ${LOAD_MASS} already ` +
      `on the hook: it is past CREAK_THRESHOLD (${CREAK_THRESHOLD}), so only ` +
      "the first-tick exemption keeps the cue quiet (specs/ui.md § Audio)",
  );
  assertLength(
    played.filter((cue) => cue === "creak"),
    0,
    "the creaks the run's first tick sounded: no member creaks on a run's " +
      "first tick (specs/ui.md § Audio)",
  );
});
