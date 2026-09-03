// audio/creak-once-across-the-structure-on-a-tick — two members crossing on one
// tick sound one creak.
//
// specs/ui.md § Audio, the `creak` row: "at most one `creak` across the structure
// per `CREAK_COOLDOWN` (`0.5`) run-clock seconds". The gate is ACROSS THE
// STRUCTURE, not per member, and § Audio says the same thing of every cue: "A cue
// plays once for the event that raises it, and at most once on a given tick or
// edit." So a tick on which two members reach `CREAK_THRESHOLD` from below sounds
// the cue exactly as often as a tick on which one does.
//
// SO IT IS DECIDED AS A COMPARISON, against a tick of the same crane that crossed
// with ONE member. That is what makes the reading a count of CUES rather than a
// count of the sources a cue takes: a build is free to make its creak out of two
// layers over the same decoded buffer, which the probe sees as two starts of one
// cue (validation/none/cues-init.js), and the comparison divides that out. A build
// that creaked per member sounds twice as much on the two-member tick and fails;
// a build that creaks once for the tick sounds the same amount on both and passes,
// whatever its creak is made of.
//
// THE TWO TICKS ARE THE SAME CRANE UNDER TWO LOADS. Hanging a hundred units on
// the hook takes exactly one member of the crane below across `0.8`; hanging a
// hundred and twenty takes two. Both are far short of any member's capacity, so
// nothing breaks and nothing else changes. Which members crossed is READ BACK from
// `run.forces` on each tick rather than assumed: the build's own solve says how
// many crossed, and the check states its verdict against that number.
//
// HOW A CROSSING IS DRIVEN. `setLoadPhase` hangs the yard's one crate on the hook
// between ticks. The bob's mass is "the hook alone, or the hook with the attached
// load" (specs/rigging.md), so the cable tension at the trolley point steps from
// the bare hook's to the load's and the crane puts that force into its members.
// The crossing is put on tick 3, since "no member creaks on a run's first tick".
//
// AND THE TWO RUNS ARE TWO RUNS OF ONE PAGE, one after the other, because that is
// all the comparison asks for. The determinism the reading rests on is the
// build's own — "the same structure and the same tape produce the same run, tick
// for tick, every time" (specs/instrumentation.md) — and the two runs differ in
// the load's mass alone. `openSite` is what parts them: it "carries the effects
// `specs/state.md` states for opening a site", which puts the run back to its
// idle placeholder and the camera back at its start pose while leaving the
// structure and the tape stored on the site, so the second run is posed by
// re-adding the load and starting it rather than by rebuilding the crane.
//
// THE FIRST RUN IS CARRIED PAST ITS OWN COOLDOWN BEFORE THE SECOND IS POSED. The
// gate is "at most one `creak` across the structure per `CREAK_COOLDOWN` (`0.5`)
// run-clock seconds", so a build that holds the gate anywhere other than the run
// it belongs to would carry a live cooldown into the second run and be reported
// as silent there for a reason that is not this point. Thirty-one further ticks
// of the first run is `0.52` seconds — past the cooldown whether a build counts
// it in run ticks or in the `simTime` that accumulates across both runs — so the
// second run's gate is open however the build keeps it.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { CREAK_THRESHOLD, GRIP_MAX_RATE } from "../constants";
import {
  addOneLoad,
  clearAll,
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

/** The load that takes one member of this crane across the threshold. */
const ONE_MEMBER_MASS = 100;

/** The load that takes two of them across it, on the same tick. */
const TWO_MEMBER_MASS = 120;

/** The tick the crossing is put on: not a run's first, which never creaks. */
const CROSS_AT = 3;

/** How many members the build reports at or above the threshold, from below it. */
function crossingCount(
  before: readonly MemberForce[],
  after: readonly MemberForce[],
): number {
  const was = new Map(before.map((f) => [f.id, f.utilization]));
  return after.filter(
    (f) =>
      f.utilization >= CREAK_THRESHOLD &&
      (was.get(f.id) ?? 0) < CREAK_THRESHOLD,
  ).length;
}

/** Where the yard's one crate stands, well clear of the crane. */
const LOAD_AT = { x: 9, y: 2, z: 6, yaw: 0 } as const;

/**
 * Ticks the first run is carried on before the second is posed.
 *
 * `0.52` run-clock seconds past the tick it creaked on, which is past
 * `CREAK_COOLDOWN` (`0.5`) whether a build counts the gate in ticks or in
 * seconds.
 */
const DRAIN = 31;

/** The crane and the tape both runs are driven on, stored on the open site. */
async function poseWorld(harness: Harness): Promise<void> {
  await openSite(harness, 0);
  await clearAll(harness);
  await poseCrane(harness, CRANE);
  await poseTape(harness, IDLE_TAPE);
}

/** One run of the crane under `mass`: what crossed on the tick, and what sounded. */
async function crossOnce(
  harness: Harness,
  mass: number,
): Promise<{ crossed: number; creaks: number }> {
  // Back to a site with no run on it, the yard emptied of the loads the site
  // opening put back, and the one load this run is about added at its mass. The
  // structure and the tape are the site's and stay as `poseWorld` left them.
  await openSite(harness, 0);
  await emptyYard(harness);
  await addOneLoad(harness, "crate", mass, LOAD_AT, LOAD_AT);
  await startRun(harness);
  await harness.cues();

  let previous: readonly MemberForce[] = [];
  let crossed = 0;
  let creaks = 0;
  for (let tick = 1; tick <= CROSS_AT; tick += 1) {
    await harness.debug.setLoadPhase(
      0,
      tick === CROSS_AT ? "attached" : "waiting",
    );
    const s = await runTicks(harness, 1);
    const played = await harness.cues();
    assertEqual(
      s.run.phase,
      "running",
      `the run still running at tick ${tick}`,
    );
    if (tick === CROSS_AT) {
      crossed = crossingCount(previous, s.run.forces);
      creaks = played.filter((c) => c === "creak").length;
    }
    previous = s.run.forces;
  }
  return { crossed, creaks };
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("sounds the creak once on a tick two members crossed together", async () => {
  await poseWorld(h);

  const together = await crossOnce(h, TWO_MEMBER_MASS);
  assertGreaterThan(
    together.crossed,
    1,
    `members reaching ${CREAK_THRESHOLD} from below on tick ${CROSS_AT} under ` +
      `${TWO_MEMBER_MASS} units, which is what makes this a tick the gate has ` +
      "to be across the structure for",
  );
  assertGreaterThan(
    together.creaks,
    0,
    `the creak the two-member crossing plays, so there is something to count`,
  );
  await h.capture("together", "The tick two members crossed together");

  // Past the first run's own cooldown, then the same run again under the mass
  // that takes one member across instead of two.
  await runTicks(h, DRAIN);
  const single = await crossOnce(h, ONE_MEMBER_MASS);
  assertEqual(
    single.crossed,
    1,
    `the members reaching ${CREAK_THRESHOLD} from below on tick ${CROSS_AT} ` +
      `under ${ONE_MEMBER_MASS} units, the tick the two-member tick is ` +
      "measured against",
  );

  assertEqual(
    together.creaks,
    single.creaks,
    `the creak the tick ${together.crossed} members crossed on sounds, against ` +
      `the tick ${single.crossed} member crossed on: at most one creak across ` +
      "the structure per tick, however many members crossed (specs/ui.md)",
  );
});
