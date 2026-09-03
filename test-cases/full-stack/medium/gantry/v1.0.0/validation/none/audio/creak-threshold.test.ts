// audio/creak-threshold — a member that reaches CREAK_THRESHOLD from below
// sounds the creak cue on that tick.
//
// specs/ui.md § Audio: "| `creak` | a member's utilization reaches
// `CREAK_THRESHOLD` (`0.8`) on a tick having been below it on the tick before,
// and no member creaks on a run's first tick …". This point is the crossing
// itself: the first tick on which the structure passes the threshold sounds the
// cue. The first-tick exemption and the cooldown are their own checks.
//
// THE CROSSING IS MADE BY A LOAD, ARRIVING ON A KNOWN TICK. The run opens with
// the bare hook on the minimal crane, whose worst utilization is far below `0.8`
// — that is the "below it on the tick before" the rule asks for, read from the
// run's own forces rather than assumed. Then a crate of `180` is hung on the
// hook with `setLoadPhase`, which specs/instrumentation.md says "hangs that load
// on the hook exactly as a successful `attach` leaves it, without the candidate
// search", and specs/rigging.md carries its mass into the cable from that tick's
// pendulum step on. The tension `(HOOK_MASS + 180) * GRAVITY`, `1850`, is well
// under `HOIST_CABLE_CAP` (`3000`) so the cable holds, and it takes the crane's
// worst utilization past `0.8` and not past `1`, so nothing breaks and the tick
// carries the crossing alone.
//
// The crossing is deliberately NOT on the run's first tick, which specs/ui.md
// exempts: the load arrives on the second, so a build that honours the exemption
// and the threshold both must sound the cue here.
//
// The tape is one long `grip` move, the one axis specs/rigging.md says "applies
// no force to anything", so the crane is loaded by the hook and the load and by
// nothing else.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertContains,
  assertEqual,
  assertGreaterThanOrEqual,
  assertLessThan,
} from "../assert";
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
  type GantrySnapshot,
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
 * Heavy enough to take the worst utilization past `CREAK_THRESHOLD`, light
 * enough to leave it under `1` so no member breaks, and light enough for the
 * cable: `(HOOK_MASS + 180) * GRAVITY` is `1850`, under `HOIST_CABLE_CAP`.
 */
const LOAD_MASS = 180;

/** A move that keeps the run alive and applies no force to the structure. */
const TAPE: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [{ axis: "grip", target: 100_000, rate: GRIP_MAX_RATE }],
  },
];

/** The highest utilization the tick's solve reported, over the intact members. */
function worst(snapshot: GantrySnapshot): number {
  return snapshot.run.forces.reduce(
    (high, one) => Math.max(high, one.utilization),
    0,
  );
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("sounds the creak cue on the tick a utilization reaches the threshold", async () => {
  await openSite(h, SITE);
  await clearAll(h);
  await standMinimalCrane(h);
  await addOneLoad(h, "crate", LOAD_MASS, HOOK, HOOK);
  await poseTape(h, TAPE);

  await startRun(h);
  const below = await runTicks(h, 1);
  assertLessThan(
    worst(below),
    CREAK_THRESHOLD,
    "the worst utilization on the tick before the crossing, under the bare " +
      `hook: the rule asks for a member "below it on the tick before" ` +
      "(specs/ui.md § Audio)",
  );

  await h.cues(); // everything the run has sounded so far, drained
  await h.debug.setLoadPhase(0, "attached");
  const crossing = await runTicks(h, 1);
  const played = await h.cues();
  await h.capture("state", "the crane on the tick its utilization crossed 0.8");

  assertEqual(
    crossing.run.phase,
    "running",
    `the run on the crossing tick: a cable tension of ` +
      `${(HOOK_MASS + LOAD_MASS) * GRAVITY} is under HOIST_CABLE_CAP ` +
      `(${HOIST_CABLE_CAP}) and no utilization passes 1, so nothing ends it ` +
      "(specs/statics.md)",
  );
  assertGreaterThanOrEqual(
    worst(crossing),
    CREAK_THRESHOLD,
    `the worst utilization on the crossing tick, with ${LOAD_MASS} on the ` +
      `hook: it reaches CREAK_THRESHOLD (${CREAK_THRESHOLD}) ` +
      "(specs/ui.md § Audio)",
  );
  assertContains(
    played,
    "creak",
    "the cues that tick sounded: `creak` plays when a member's utilization " +
      `reaches CREAK_THRESHOLD (${CREAK_THRESHOLD}) having been below it on ` +
      "the tick before (specs/ui.md § Audio)",
  );
});
