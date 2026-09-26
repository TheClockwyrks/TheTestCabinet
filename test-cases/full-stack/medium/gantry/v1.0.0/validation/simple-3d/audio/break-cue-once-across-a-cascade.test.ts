// audio/break-cue-once-across-a-cascade — a cascading breakage sounds break once.
//
// specs/ui.md § Audio gives the row "`break` | a tick breaks one or more members,
// once for the tick", and says of every cue: "A cue plays once for the event that
// raises it, and at most once on a given tick or edit."
//
// The event a break cue answers to is A TICK, and a tick can break members more
// than once. specs/statics.md § Utilization and breakage: "every member whose
// utilization exceeds `1` breaks: all of them are removed at once... Both solves
// then run again at the same tick, over the members still intact... Repeat until
// a pass breaks nothing or a pass fails." So a build that raised the cue from the
// breakage PASS rather than from the tick sounds it twice on a tick that cascades,
// and that is what this decides.
//
// TWO TICKS, ONE MEASURED AGAINST THE OTHER. Both hang a crate on the hook of a
// crane that cannot hold it, and both are the tick that breaks under it:
//
//   - The cascade. The jib crane below under a hundred and thirty-seven units
//     breaks members on TWO passes, and the run's own record says so: a pass "joins
//     the run's list of broken members in ascending member-id order", so a
//     `run.broken` that is NOT in ascending order was filled by more than one pass.
//     The check reads that order back rather than assuming it.
//   - The single pass. `MINIMAL_CRANE` under two hundred and forty units breaks
//     exactly ONE member, which no ordering can spread over two passes.
//
// Both ticks end the run the same way, so the only difference between them is the
// number of passes their breakage took.
//
// BOTH TICKS ARE DRIVEN IN ONE PAGE. `openSite` "carries the effects
// `specs/state.md` states for opening a site" — the run back to its idle
// placeholder, the yard refilled — and `clearAll` empties the yard, the structure
// and the tape after it, so the second crane is posed into the same world the
// first was and nothing of the first run is standing when it runs. A second
// browser page would buy nothing but the second page.
//
// AND IT COMPARES COUNTS RATHER THAN COUNTING. A build is free to make its snap
// out of two layers over the same decoded buffer, which the probe sees as two
// starts of one cue (validation/none/cues-init.js), so "exactly once" is not
// something a sound count can read on its own. What it can read is that the
// cascading tick sounded the cue no more than the single-pass tick did — once for
// the tick, whatever the tick's breakage did.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertTrue } from "../assert";
import { GRIP_MAX_RATE } from "../constants";
import {
  MINIMAL_CRANE,
  addOneLoad,
  clearAll,
  createHarness,
  openSite,
  poseCrane,
  poseTape,
  runTicks,
  startRun,
  type CraneDesign,
  type Harness,
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

/** The load the jib crane breaks under, on two passes of one tick. */
const CASCADE_MASS = 137;

/** The load the minimal crane breaks under, one member and one pass. */
const SINGLE_MASS = 240;

/** The tick the load is hung on: clear of a run's first tick. */
const BREAK_AT = 3;

/** What one breaking tick did: the members it broke, and the snaps it sounded. */
interface Breakage {
  broken: number[];
  breaks: number;
}

/** Hang `mass` on `design`'s hook on a known tick, and read that tick back. */
async function breakUnder(
  harness: Harness,
  design: CraneDesign,
  mass: number,
): Promise<Breakage> {
  await openSite(harness, 0);
  await clearAll(harness);
  await poseCrane(harness, design);
  await poseTape(harness, IDLE_TAPE);
  await addOneLoad(
    harness,
    "crate",
    mass,
    { x: 9, y: 2, z: 6, yaw: 0 },
    { x: 9, y: 2, z: 6, yaw: 0 },
  );
  await startRun(harness);

  for (let tick = 1; tick < BREAK_AT; tick += 1) {
    const s = await runTicks(harness, 1);
    assertEqual(
      s.run.phase,
      "running",
      `the run still running at tick ${tick}`,
    );
    assertEqual(
      s.run.broken.length,
      0,
      `the members broken before tick ${BREAK_AT}, so the breakage under test ` +
        "is that one tick's",
    );
  }
  await harness.cues();
  await harness.debug.setLoadPhase(0, "attached");
  const broke = await runTicks(harness, 1);
  const played = await harness.cues();
  return {
    broken: [...broke.run.broken],
    breaks: played.filter((c) => c === "break").length,
  };
}

/** Whether a list of member ids climbs, as one breakage pass records them. */
const ascending = (ids: readonly number[]): boolean =>
  ids.every((id, at) => at === 0 || id > ids[at - 1]!);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("sounds break no more on a cascading tick than on a single-pass one", async () => {
  const cascade = await breakUnder(h, CRANE, CASCADE_MASS);
  await h.capture("one-snap", "The tick whose breakage cascaded");

  assertGreaterThan(
    cascade.broken.length,
    1,
    `the members the tick broke under ${CASCADE_MASS} units, so the tick has a ` +
      "cascade to sound for",
  );
  assertTrue(
    !ascending(cascade.broken),
    `run.broken after the cascading tick to run out of member-id order — a ` +
      "breakage pass records its members in ascending id order " +
      "(specs/statics.md), so [" +
      cascade.broken.join(", ") +
      "] was filled by more than one pass",
  );

  const once = await breakUnder(h, MINIMAL_CRANE, SINGLE_MASS);
  assertEqual(
    once.broken.length,
    1,
    `the members the minimal crane's tick broke under ${SINGLE_MASS} units, ` +
      "which is the one-pass tick the cascade is measured against",
  );

  assertEqual(
    cascade.breaks,
    once.breaks,
    `the break the cascading tick sounded, against the tick that broke on one ` +
      "pass: a cue plays at most once on a given tick, so a tick whose " +
      "breakage cascades still plays break once for the tick (specs/ui.md)",
  );
});
