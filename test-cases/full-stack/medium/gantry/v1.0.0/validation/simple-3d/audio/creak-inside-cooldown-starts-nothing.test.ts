// audio/creak-inside-cooldown-starts-nothing — a suppressed crossing starts no
// cooldown of its own.
//
// specs/ui.md § Audio, the `creak` row: "a tick that has an eligible member but
// falls inside the cooldown plays nothing and starts no new cooldown", so "the
// first tick eligible again is `CREAK_COOLDOWN * TICK_HZ` (`30`) ticks after" the
// tick the creak PLAYED on.
//
// That is a statement about where the next creak falls, so it takes four
// crossings to decide. A creak plays on tick 3 and opens the cooldown. A crossing
// on tick 13 falls inside it and is suppressed. A crossing on tick 33 is exactly
// thirty ticks after the creak that played, so it is the first tick eligible
// again and it creaks. A crossing on tick 43 is ten ticks after THAT one and is
// suppressed in its turn.
//
// A build that let the suppressed crossing on tick 13 restart the cooldown would
// hold its silence until tick 43 and creak there instead — the two runs differ on
// both of the last two ticks, which is what makes this reading decide the "starts
// no new cooldown" clause rather than the cooldown's length.
//
// HOW A CROSSING IS DRIVEN. The yard holds one crate, and `setLoadPhase` hangs it
// on the hook or takes it off between ticks. The bob's mass is "the hook alone, or
// the hook with the attached load" (specs/rigging.md), so the cable tension the
// structure carries at the trolley point steps between the bare hook's and a
// hundred-and-twenty-unit load's, and the crane below puts that force into its own
// members. Nothing fabricates a utilization: the pose sets the mass on the cable
// and the build's own solve decides the rest, so every crossing is READ BACK from
// `run.forces` before it is used.
//
// AND ONLY THE FOUR CROSSING TICKS ARE SAMPLED. The ticks between them carry the
// bare hook and cross nothing, so they are driven in one batch each: what the
// point reads on a crossing tick is the forces the tick before it left — which is
// the state the batch answers with — and the cues that tick alone played, which is
// the queue drained immediately before it. Sampling the forty-three ticks one at a
// time reads thirty-nine states no assertion looks at.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import {
  CREAK_COOLDOWN,
  CREAK_THRESHOLD,
  GRIP_MAX_RATE,
  TICK_HZ,
} from "../constants";
import {
  addOneLoad,
  createHarness,
  emptyYard,
  openSite,
  poseCrane,
  poseTape,
  runTicks,
  startRun,
  type CraneDesign,
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

/** The cooldown as specs/ui.md counts it: whole ticks. */
const COOLDOWN_TICKS = CREAK_COOLDOWN * TICK_HZ;

/** The creak that opens the cooldown. */
const FIRST = 3;

/** The four crossings: the creak, one inside, the first eligible again, one inside that. */
const CROSSINGS = [
  FIRST,
  FIRST + 10,
  FIRST + COOLDOWN_TICKS,
  FIRST + COOLDOWN_TICKS + 10,
];

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

it("counts the next creak from the creak that played, not from a suppressed crossing", async () => {
  await openSite(h, 0);
  // The YARD alone, rather than the whole world: the crane pose below empties
  // the structure itself, and a site opens with an empty tape
  // (`specs/state.md`), so there is nothing else here to clear.
  await emptyYard(h);
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

  let at = 0;
  let previous: readonly MemberForce[] = [];
  const crossed = new Map<number, number>();
  const creaks = new Map<number, number>();

  for (const tick of CROSSINGS) {
    // The run up to the tick before the crossing, with the hook bare: one batch,
    // answering the forces the crossing is read against.
    await h.debug.setLoadPhase(0, "waiting");
    if (tick - 1 > at) {
      const carried = await runTicks(h, tick - 1 - at);
      at = tick - 1;
      assertEqual(
        carried.run.phase,
        "running",
        `the run still running at tick ${at}`,
      );
      previous = carried.run.forces;
    }
    // Whatever those ticks sounded is not this crossing's, so the queue is
    // drained before the crossing tick is driven.
    await h.cues();

    await h.debug.setLoadPhase(0, "attached");
    const s = await runTicks(h, 1);
    at = tick;
    const played = await h.cues();
    assertEqual(
      s.run.phase,
      "running",
      `the run still running at tick ${tick}`,
    );
    crossed.set(tick, crossings(previous, s.run.forces).length);
    creaks.set(tick, played.filter((c) => c === "creak").length);
    previous = s.run.forces;
  }

  await h.capture("cooldown", "The three crossings after the first creak");

  for (const tick of CROSSINGS) {
    assertGreaterThan(
      crossed.get(tick) ?? 0,
      0,
      `a member reaching ${CREAK_THRESHOLD} from below on tick ${tick}, so ` +
        "that tick has an eligible member",
    );
  }

  assertGreaterThan(
    creaks.get(CROSSINGS[0]!) ?? 0,
    0,
    `the creak tick ${CROSSINGS[0]} plays, which opens the cooldown (specs/ui.md)`,
  );
  assertEqual(
    creaks.get(CROSSINGS[1]!),
    0,
    `the creaks tick ${CROSSINGS[1]} plays: it falls inside the cooldown opened ` +
      `on tick ${CROSSINGS[0]} (specs/ui.md)`,
  );
  assertGreaterThan(
    creaks.get(CROSSINGS[2]!) ?? 0,
    0,
    `the creak tick ${CROSSINGS[2]} plays: the first tick eligible again is ` +
      `CREAK_COOLDOWN * TICK_HZ (${COOLDOWN_TICKS}) ticks after the creak on ` +
      `tick ${CROSSINGS[0]}, since the suppressed crossing on tick ` +
      `${CROSSINGS[1]} started no new cooldown (specs/ui.md)`,
  );
  assertEqual(
    creaks.get(CROSSINGS[3]!),
    0,
    `the creaks tick ${CROSSINGS[3]} plays: it falls inside the cooldown the ` +
      `creak on tick ${CROSSINGS[2]} opened (specs/ui.md)`,
  );
});
