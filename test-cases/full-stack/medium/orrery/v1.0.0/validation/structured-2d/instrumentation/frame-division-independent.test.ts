// instrumentation/frame-division-independent — one second of game time reaches one
// state, whether it arrived as a single frame or as sixty.
//
// THE RULE. "The surface rests on the simulation being deterministic: the run
// advances by simulated cycles integrated against the delta time the game is
// given, so an interval of game time reaches the same state however it was divided
// into frames. Everything that interval decides comes out identical whatever the
// division: the cycle count, every live pose and grip, the hex every mote rests
// on, the filaments, the tallies, the area bank, the fault, and whether the run
// completed" (`specs/instrumentation.md`, A deterministic core). The clock section
// says the same in figures: "A run advances by `SPEEDS[sim.speed]` cycles per
// second of game time, so `advance(1, 1)` and `advance(1, 60)` cover the same
// cycles and reach the same outcome ... every cycle runs in full whatever the
// frame that crossed it." `specs/simulation.md` states the boundary case the two
// divisions turn on: "A span of game time that lands exactly on a boundary
// completes that cycle however many frames covered it."
//
// THE THREE RUNNING SUMS ARE READ WITH A TOLERANCE, and nothing else is. The
// specification carries `simTime`, `sim.fraction` and the drawn positions derived
// from it as sums of the frames' own delta times, which "agree to within the
// rounding of that sum rather than bit for bit" — and one frame of a whole second
// and sixty of a sixtieth are exactly the two sums that round differently. Every
// other reading below is compared for equality, because the specification lists it
// as coming out identical.
//
// THE MACHINE MUST ACTUALLY MOVE, or the point decides nothing: a build whose
// carries move nothing reaches the same state both ways trivially. So the machine
// is the shortest complete carrying cycle — `grab`, `rotate-cw`, `drop`,
// `rotate-ccw` — and the second under test covers its first three cycles, which
// the check reads back: the mote it started on `(1, 0)` is resting on `(0, 1)`,
// held by nothing, in both divisions.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertLength,
  assertNear,
  assertNotNull,
  assertNull,
} from "../assert";
import {
  DEFAULT_SPEED_INDEX,
  FRACTION_TOLERANCE,
  HEX_PITCH,
  SPEEDS,
} from "../constants";
import { at } from "../field";
import { BARE, CARRY_MACHINE } from "../fixtures";
import {
  captureReplay,
  createHarness,
  heldBy,
  moteAt,
  openBareRun,
  partIds,
  spawnMote,
  type Harness,
  type OrrerySnapshot,
} from "../harness";

/**
 * How near two drawn positions must land when the fractions behind them agree to
 * `FRACTION_TOLERANCE`.
 *
 * A mote's `x`, `y` are "derived from ... `sim.fraction`"
 * (`specs/instrumentation.md`), and the fastest thing any motion of
 * `specs/simulation.md` does to a mote over one cycle is carry it once around a
 * circle of the arm's own radius, so a fraction agreeing to `FRACTION_TOLERANCE`
 * puts the positions within that circumference times the same figure.
 */
const POSITION_TOLERANCE = 2 * Math.PI * HEX_PITCH * FRACTION_TOLERANCE;

/** The hex the carried mote starts on: the gripper of an arm at ORIGIN, rotation 0. */
const GRIPPED = at(1, 0);

/** Where `rotate-cw` about ORIGIN lands it. */
const CARRIED_TO = at(0, 1);

/** Everything the specification lists as coming out identical whatever the division. */
function decided(snapshot: OrrerySnapshot, parts: readonly number[]): unknown {
  const sim = snapshot.sim;
  const index = (part: number): number => parts.indexOf(part);
  return {
    status: sim?.status,
    cycle: sim?.cycle,
    speed: sim?.speed,
    completed: sim?.status === "complete",
    motes: (sim?.motes ?? [])
      .map((mote) => ({ q: mote.q, r: mote.r, type: mote.type }))
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

/** The drawn positions of the motes on the field, in the order the sort above puts them. */
function drawn(snapshot: OrrerySnapshot): { x: number; y: number }[] {
  return (snapshot.sim?.motes ?? [])
    .slice()
    .sort((a, b) => a.q - b.q || a.r - b.r || a.type.localeCompare(b.type))
    .map((mote) => ({ x: mote.x, y: mote.y }));
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** Pose the carrying machine with one mote in its gripper, and answer the part ids. */
async function poseCarry(): Promise<number[]> {
  await openBareRun(h, { challenge: BARE, machine: CARRY_MACHINE });
  await spawnMote(h, GRIPPED, "sol");
  return partIds(h);
}

it("reaches the same state over one second, covered by one frame or by sixty", async () => {
  const seconds = 1;

  const partsOnce = await poseCarry();
  const opened = await h.snapshot();
  assertEqual(
    opened.sim?.speed,
    DEFAULT_SPEED_INDEX,
    "a run opens at DEFAULT_SPEED_INDEX, which is the speed this second is covered at",
  );
  assertEqual(
    partsOnce.length,
    1,
    "the machine is one arm, and the whole of what the second moves",
  );
  await h.advanceSeconds(seconds, 1);
  const inOne = await h.snapshot();

  const partsMany = await poseCarry();
  await captureReplay(h, "divided", () => h.advanceSeconds(seconds, 60));
  const inSixty = await h.snapshot();

  // The second really carried the mote, in both divisions: a machine that moved
  // nothing would reach the same state either way and decide nothing here.
  assertNotNull(inSixty.sim, "the run is live after the second");
  assertEqual(
    inSixty.sim?.cycle,
    SPEEDS[DEFAULT_SPEED_INDEX],
    "a second of game time runs SPEEDS[sim.speed] cycles, whatever the division",
  );
  assertLength(
    inSixty.sim?.motes ?? [],
    1,
    "one mote is on the field, and it is the one the arm carried",
  );
  assertEqual(
    moteAt(inSixty, CARRIED_TO)?.type,
    "sol",
    "grab, rotate-cw and drop carried it from (1, 0) to (0, 1) and let it go",
  );
  assertNull(
    moteAt(inSixty, GRIPPED),
    "so nothing is resting on the hex it started on",
  );
  assertNull(
    heldBy(inSixty, partsMany[0] ?? -1, 0),
    "and the gripper that carried it is open again",
  );

  assertDeepEqual(
    decided(inSixty, partsMany),
    decided(inOne, partsOnce),
    "the cycle count, the poses, the grips, the motes' hexes, the filaments, the tallies, the area and the fault come out identical whatever the division",
  );

  assertNear(
    inSixty.sim?.fraction ?? -1,
    inOne.sim?.fraction ?? -1,
    FRACTION_TOLERANCE,
    "and sim.fraction, a running sum of the frames' delta times, agrees to its rounding",
  );

  const positionsOne = drawn(inOne);
  const positionsSixty = drawn(inSixty);
  assertLength(
    positionsSixty,
    positionsOne.length,
    "the same motes are on the field in both divisions",
  );
  for (const [i, position] of positionsSixty.entries()) {
    const expected = positionsOne[i] ?? { x: NaN, y: NaN };
    assertNear(
      position.x,
      expected.x,
      POSITION_TOLERANCE,
      `mote ${i} is drawn at the same x however the second was divided`,
    );
    assertNear(
      position.y,
      expected.y,
      POSITION_TOLERANCE,
      `mote ${i} is drawn at the same y however the second was divided`,
    );
  }
});
