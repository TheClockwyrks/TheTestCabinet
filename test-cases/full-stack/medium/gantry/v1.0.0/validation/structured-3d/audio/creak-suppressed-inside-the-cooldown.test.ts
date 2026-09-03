// audio/creak-suppressed-inside-the-cooldown — a crossing inside the cooldown is
// silent.
//
// specs/ui.md § Audio, the `creak` row: the cue plays when "a member's utilization
// reaches `CREAK_THRESHOLD` (`0.8`) on a tick having been below it on the tick
// before", but "at most one `creak` across the structure per `CREAK_COOLDOWN`
// (`0.5`) run-clock seconds, counted in whole ticks from the tick the last one
// played: the first tick eligible again is `CREAK_COOLDOWN * TICK_HZ` (`30`) ticks
// after that one, and a tick that has an eligible member but falls inside the
// cooldown plays nothing".
//
// So this decides the SILENCE, and it needs a tick that would otherwise creak:
// one with a member that reaches `0.8` having been below it, close behind a creak
// that did play. Ten ticks after is a sixth of a second of run clock, a third of
// the way into the cooldown.
//
// HOW A CROSSING IS DRIVEN. The yard holds one crate, and `setLoadPhase` hangs it
// on the hook or takes it off between ticks. The bob's mass is "the hook alone, or
// the hook with the attached load" (specs/rigging.md), so the cable tension the
// structure carries at the trolley point steps between the bare hook's and a
// hundred-and-twenty-unit load's, and the crane above puts that force into its own
// members. Nothing here fabricates a utilization: the pose sets the mass hanging
// on the cable and the build's own solve decides what that does to every member,
// which is why the crossing is READ BACK from `run.forces` on each tick — a tick
// counts as eligible here only when the build itself reports a member at or above
// `0.8` that stood below it on the tick before, exactly as specs/ui.md words it.
//
// The first tick of a run is left alone ("no member creaks on a run's first tick")
// and the crossings are put at ticks 3 and 13.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertTrue } from "../assert";
import { CREAK_COOLDOWN, CREAK_THRESHOLD, GRIP_MAX_RATE, TICK_HZ } from "../constants";
import {
  addOneLoad,
  clearAll,
  createHarness,
  openSite,
  poseCrane,
  poseTape,
  runTicks,
  startRun,
  type CraneDesign,
  type GantrySnapshot,
  type Harness,
  type MemberForce,
  type TapeStepSpec,
} from "../harness";

/**
 * A jib crane whose most-loaded members answer to the hook, and to nothing else.
 *
 * A braced tower between site 1's four ground anchors and the ring's bottom
 * flange at `y` `4`; a mast head at `(2, 10, 0)` tied to all four top-flange
 * nodes; a jib out to `(4, 6, 0)`, hung from the mast head and braced out of
 * plane; and one rail from `(4, 6, 0)` to `(6, 6, 0)`, whose two ends stand at
 * distinct horizontal distances from the slew axis, so the track's origin — where
 * the trolley begins every run (specs/structure.md) — is the jib node rather than
 * a flange node. That is the whole point of the shape: the cable force is applied
 * at the trolley point, and a trolley point out on the jib puts that force into
 * the arm's own members instead of straight into a support.
 *
 * Every node lies inside site 1's envelope and the crane costs well under its
 * budget, so it poses unrefused on an emptied yard.
 */
const CRANE: CraneDesign = {
  site: 1,
  name: "Creak jib",
  ring: [0, 4, 0],
  counterweights: [],
  members: [
    // The tower: four legs, the bottom flange square with one diagonal, and one
    // diagonal on each of the tower's four sides.
    [[0, 0, 0], [0, 4, 0], "strut"],
    [[2, 0, 0], [2, 4, 0], "strut"],
    [[0, 0, 2], [0, 4, 2], "strut"],
    [[2, 0, 2], [2, 4, 2], "strut"],
    [[0, 4, 0], [2, 4, 0], "strut"],
    [[0, 4, 2], [2, 4, 2], "strut"],
    [[0, 4, 0], [0, 4, 2], "strut"],
    [[2, 4, 0], [2, 4, 2], "strut"],
    [[0, 4, 0], [2, 4, 2], "strut"],
    [[0, 0, 0], [2, 4, 0], "strut"],
    [[0, 0, 0], [0, 4, 2], "strut"],
    [[2, 0, 0], [2, 4, 2], "strut"],
    [[0, 0, 2], [2, 4, 2], "strut"],
    // The mast, tied to all four top-flange nodes.
    [[0, 6, 0], [2, 10, 0], "strut"],
    [[2, 6, 0], [2, 10, 0], "strut"],
    [[0, 6, 2], [2, 10, 0], "strut"],
    [[2, 6, 2], [2, 10, 0], "strut"],
    // The jib node, braced in plane, out of plane, and hung from the mast.
    [[2, 6, 0], [4, 6, 0], "strut"],
    [[2, 6, 2], [4, 6, 0], "strut"],
    [[2, 10, 0], [4, 6, 0], "strut"],
    // The track, and the two ties that hold its far end up.
    [[4, 6, 0], [6, 6, 0], "rail"],
    [[2, 6, 2], [6, 6, 0], "strut"],
    [[2, 10, 0], [6, 6, 0], "cable"],
  ],
  tape: [],
};

/**
 * A tape that keeps the run going and puts no force into anything.
 *
 * specs/rigging.md: "Turning the grip applies no force to anything", and with no
 * load attached it "turns the bare hook, visibly and to no other effect". So a
 * long grip move is a run that ticks for eighty seconds while the structure
 * carries exactly what this check puts on it.
 */
const IDLE_TAPE: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [{ axis: "grip", target: 3600, rate: GRIP_MAX_RATE }],
  },
];

/** The load whose weight, hung on the hook, drives a member across the threshold. */
const LOAD_MASS = 120;

/** The tick the creak that opens the cooldown plays on. */
const FIRST = 3;

/** The suppressed crossing: well inside CREAK_COOLDOWN * TICK_HZ (30) ticks. */
const INSIDE = FIRST + 10;

/** The members the build reports at or above the threshold, from below it. */
function crossings(
  before: readonly MemberForce[],
  after: readonly MemberForce[],
): MemberForce[] {
  const was = new Map(before.map((f) => [f.id, f.utilization]));
  return after.filter(
    (f) =>
      f.utilization >= CREAK_THRESHOLD &&
      (was.get(f.id) ?? 0) < CREAK_THRESHOLD,
  );
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("sounds nothing on a crossing that falls inside the creak cooldown", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await poseCrane(h, CRANE);
  await poseTape(h, IDLE_TAPE);
  await addOneLoad(
    h,
    "crate",
    LOAD_MASS,
    { x: 9, y: 2, z: 6, yaw: 0 },
    { x: 9, y: 2, z: 6, yaw: 0 },
  );
  await startRun(h);
  await h.cues();

  let previous: readonly MemberForce[] = [];
  const crossed = new Map<number, MemberForce[]>();
  const creaks = new Map<number, number>();
  let last: GantrySnapshot | null = null;

  for (let tick = 1; tick <= INSIDE; tick += 1) {
    await h.debug.setLoadPhase(0, tick === FIRST || tick === INSIDE ? "attached" : "waiting");
    const s = await runTicks(h, 1);
    const played = await h.cues();
    assertEqual(s.run.phase, "running", `the run still running at tick ${tick}`);
    crossed.set(tick, crossings(previous, s.run.forces));
    creaks.set(tick, played.filter((c) => c === "creak").length);
    previous = s.run.forces;
    last = s;
  }

  assertGreaterThan(
    crossed.get(FIRST)?.length ?? 0,
    0,
    `a member reaching ${CREAK_THRESHOLD} from below on tick ${FIRST}, which is ` +
      "what opens the cooldown",
  );
  assertGreaterThan(
    creaks.get(FIRST) ?? 0,
    0,
    `the creak tick ${FIRST} plays, which starts the cooldown (specs/ui.md)`,
  );
  assertGreaterThan(
    crossed.get(INSIDE)?.length ?? 0,
    0,
    `a member reaching ${CREAK_THRESHOLD} from below on tick ${INSIDE}, so that ` +
      "tick has an eligible member",
  );
  assertTrue(
    (last?.run.tick ?? 0) - FIRST < CREAK_COOLDOWN * TICK_HZ,
    `tick ${INSIDE} falling inside the cooldown, ${CREAK_COOLDOWN * TICK_HZ} ` +
      `ticks from the creak on tick ${FIRST}`,
  );

  assertEqual(
    creaks.get(INSIDE),
    0,
    `the creaks tick ${INSIDE} plays: a tick that has an eligible member but ` +
      `falls inside CREAK_COOLDOWN (${CREAK_COOLDOWN}s, ` +
      `${CREAK_COOLDOWN * TICK_HZ} ticks) of the creak on tick ${FIRST} plays ` +
      "nothing (specs/ui.md)",
  );

  await h.capture("suppressed", "The suppressed crossing");
});
