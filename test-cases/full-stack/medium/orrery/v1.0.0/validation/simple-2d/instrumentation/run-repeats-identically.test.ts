// instrumentation/run-repeats-identically — the same machine on the same challenge
// runs the same run twice, cycle for cycle.
//
// THE RULE. "No randomness. The same machine on the same challenge produces the
// same run, cycle for cycle, at any frame rate. The produced effects
// `specs/assets.md` fixes vary from one play to the next, and that variation
// reaches nothing this surface reads" (`specs/instrumentation.md`, A deterministic
// core). `specs/simulation.md` states it from the simulation's side: "The
// simulation is a function of the machine and the elapsed simulated time. Cycle
// outcomes, collisions included, are computed from the machine's parts, tapes, and
// the sample fractions, and no rule of the simulation draws on randomness."
//
// CYCLE FOR CYCLE, RATHER THAN AT THE END. A run that drew on randomness and
// happened to settle in the same place would pass a check that read only the last
// boundary, so both sessions are sampled at every boundary AND part way through
// every cycle, and the two sequences are compared entry by entry. The first moment
// the two disagree at is the one the failure names. The mid-cycle samples are what
// reach a motion: at a boundary "every mote lands exactly on a hex center"
// (`specs/simulation.md`), so a boundary alone cannot see a sweep that ran
// differently on its way there.
//
// WHAT IS COMPARED IS NOT AN ID. Both sessions are posed identically, so the parts
// are in the same placement order and the motes on the same hexes, and the sample
// below is written in those terms — a part by its index in placement order, a mote
// by the hex it rests on and its type — rather than by the numbers the build hands
// out. `specs/instrumentation.md` fixes the ORDER of `editor.parts` and the id of a
// newly placed part; it fixes no id a second session must reuse, and grading one
// would grade an implementation.
//
// THE MACHINE MUST MOVE. The shortest complete carrying cycle — `grab`,
// `rotate-cw`, `drop`, `rotate-ccw` — carries the mote off the hex it started on
// and leaves it on another, which the check reads back before comparing the two
// sessions, so a build whose run does nothing cannot pass by repeating nothing.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertLength,
  assertNear,
  assertNotNull,
} from "../assert";
import { FRACTION_TOLERANCE, HEX_PITCH } from "../constants";
import { at } from "../field";
import { BARE, CARRY_MACHINE } from "../fixtures";
import {
  advanceFraction,
  captureReplay,
  createHarness,
  moteAt,
  openBareRun,
  partIds,
  spawnMote,
  type Harness,
  type OrrerySnapshot,
} from "../harness";

/** See `frame-division-independent`: the drawn positions follow `sim.fraction`. */
const POSITION_TOLERANCE = 2 * Math.PI * HEX_PITCH * FRACTION_TOLERANCE;

/** The hex the carried mote starts on: the gripper of an arm at (0, 0), rotation 0. */
const GRIPPED = at(1, 0);

/** Where `rotate-cw` about (0, 0) lands it. */
const CARRIED_TO = at(0, 1);

/** Enough cycles to run the machine's whole period and start it again. */
const CYCLES = 6;

/** Where in each cycle the mid-cycle sample is taken. */
const MIDPOINT = 0.5;

/** One moment of a run, in terms no id and no ordering accident can reach. */
function boundary(snapshot: OrrerySnapshot, parts: readonly number[]): unknown {
  const sim = snapshot.sim;
  const index = (part: number): number => parts.indexOf(part);
  return {
    status: sim?.status,
    cycle: sim?.cycle,
    speed: sim?.speed,
    motes: (sim?.motes ?? [])
      .map((mote) => ({
        q: mote.q,
        r: mote.r,
        type: mote.type,
        fixture: mote.wheel !== null,
      }))
      .sort((a, b) => a.q - b.q || a.r - b.r || a.type.localeCompare(b.type)),
    filaments: (sim?.filaments ?? []).length,
    poses: (sim?.poses ?? [])
      .map((pose) => ({
        part: index(pose.part),
        rotation: pose.rotation,
        length: pose.length,
        cell: pose.cell,
      }))
      .sort((a, b) => a.part - b.part),
    grips: (sim?.grips ?? [])
      .map((grip) => ({ part: index(grip.part), spoke: grip.spoke }))
      .sort((a, b) => a.part - b.part || a.spoke - b.spoke),
    tallies: sim?.tallies,
    area: sim?.area,
    fault:
      sim?.fault === null || sim?.fault === undefined
        ? null
        : { kind: sim.fault.kind, parts: sim.fault.parts.map(index) },
  };
}

/** The drawn positions at one boundary, in the order {@link boundary} sorts them. */
function drawn(snapshot: OrrerySnapshot): { x: number; y: number }[] {
  return (snapshot.sim?.motes ?? [])
    .slice()
    .sort((a, b) => a.q - b.q || a.r - b.r || a.type.localeCompare(b.type))
    .map((mote) => ({ x: mote.x, y: mote.y }));
}

/** What one session of the run is read as: one entry per moment it was sampled at. */
interface Session {
  moments: string[];
  states: unknown[];
  fractions: number[];
  positions: { x: number; y: number }[][];
  last: OrrerySnapshot;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** Pose the world, run it cycle by cycle, and read every moment on the way. */
async function session(): Promise<Session> {
  await openBareRun(h, { challenge: BARE, machine: CARRY_MACHINE });
  await spawnMote(h, GRIPPED, "sol");
  const parts = await partIds(h);
  const read: Session = {
    moments: [],
    states: [],
    fractions: [],
    positions: [],
    last: await h.snapshot(),
  };
  const sample = async (moment: string): Promise<void> => {
    const snapshot = await h.snapshot();
    read.moments.push(moment);
    read.states.push(boundary(snapshot, parts));
    read.fractions.push(snapshot.sim?.fraction ?? -1);
    read.positions.push(drawn(snapshot));
    read.last = snapshot;
  };
  for (let cycle = 0; cycle < CYCLES; cycle += 1) {
    await advanceFraction(h, MIDPOINT);
    await sample(`half way through cycle ${cycle}`);
    await advanceFraction(h, 1 - MIDPOINT);
    await sample(`the boundary ending cycle ${cycle}`);
  }
  return read;
}

it("runs the same run twice over, cycle for cycle", async () => {
  const first = await session();
  const second = await captureReplay(h, "repeat", () => session());

  // The run did something, in both sessions: a machine that carried nothing
  // would repeat nothing and decide nothing here.
  assertNotNull(second.last.sim, "the second session's run is live at the end");
  assertEqual(
    second.last.sim?.cycle,
    CYCLES,
    "both sessions were given the same game time, and it ran",
  );
  assertEqual(
    moteAt(second.last, CARRIED_TO)?.type,
    "sol",
    "grab, rotate-cw and drop carried the mote from (1, 0) to (0, 1)",
  );
  assertEqual(
    moteAt(first.last, CARRIED_TO)?.type,
    "sol",
    "and the first session carried it there too",
  );

  assertLength(
    second.states,
    first.states.length,
    "both sessions were sampled at the same number of moments",
  );
  for (const [i, state] of second.states.entries()) {
    const moment = second.moments[i] ?? `moment ${i}`;
    assertDeepEqual(
      state,
      first.states[i],
      `the second run reports at ${moment} what the first reported there: no rule of the simulation draws on randomness`,
    );
    assertNear(
      second.fractions[i] ?? -1,
      first.fractions[i] ?? -1,
      FRACTION_TOLERANCE,
      `and sim.fraction at ${moment} agrees to the rounding of its sum`,
    );
    const after = second.positions[i] ?? [];
    const before = first.positions[i] ?? [];
    assertLength(
      after,
      before.length,
      `the same motes are on the field at ${moment}`,
    );
    for (const [m, position] of after.entries()) {
      const expected = before[m] ?? { x: NaN, y: NaN };
      assertNear(
        position.x,
        expected.x,
        POSITION_TOLERANCE,
        `mote ${m} is drawn at the same x at ${moment}`,
      );
      assertNear(
        position.y,
        expected.y,
        POSITION_TOLERANCE,
        `mote ${m} is drawn at the same y at ${moment}`,
      );
    }
  }
});
