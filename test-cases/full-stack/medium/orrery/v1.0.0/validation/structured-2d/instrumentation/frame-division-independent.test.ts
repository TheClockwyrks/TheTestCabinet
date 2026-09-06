// instrumentation/frame-division-independent — one second of game time reaches the
// state the specification fixes, whether it arrived as a single frame or as sixty.
//
// THE RULE. "The surface rests on a fixed-timestep core that advances apart from
// its drawing: the run advances by simulated cycles integrated against the delta
// time the game is given, so an interval of game time reaches the same state
// however it was divided into frames. Everything that interval decides comes out
// the same whatever the division: the cycle count, every live pose and grip, the
// hex every mote rests on, the filaments, the tallies, the area bank, the fault,
// and whether the run completed" (`specs/instrumentation.md`, A render-free
// core). The clock section says the same in figures: "A run advances by
// `SPEEDS[sim.speed]` cycles per second of game time, so `advance(1, 1)` and
// `advance(1, 60)` cover the same cycles and reach the same outcome ... every
// cycle runs in full whatever the frame that crossed it." `specs/simulation.md`
// states the boundary case the two divisions turn on: "A span of game time that
// lands exactly on a boundary completes that cycle however many frames covered
// it."
//
// EACH DIVISION IS READ AGAINST THE SPECIFICATION, NOT AGAINST THE OTHER. What
// one second leaves the carrying machine in is a state the rules fix outright:
// three cycles at `SPEEDS[1]`, so `grab`, `rotate-cw` and `drop` have each run in
// full and `rotate-ccw` has not begun; the mote carried from `(1, 0)` to `(0, 1)`
// ("Rotating a direction index clockwise adds `1` modulo `6`", `specs/field.md`)
// and let go there; the arm one step clockwise; nothing held; no filament; the
// one product's tally at `0`; and the area bank holding three hexes — the anchor
// and the resting gripper hex it "takes ... at the start of the run", and the hex
// the mote and the gripper both moved to, taken "after every boundary"
// (`specs/simulation.md`, Completion and metrics). A division that reaches that
// state has run every cycle the second covers, and two that both do have reached
// the same state.
//
// THE THREE RUNNING SUMS ARE READ WITH A TOLERANCE, and nothing else is. The
// specification carries `simTime`, `sim.fraction` and the drawn positions derived
// from it as sums of the frames' own delta times, which "agree to within the
// rounding of that sum rather than bit for bit" — and one frame of a whole second
// and sixty of a sixtieth are exactly the two sums that round differently. The
// fraction is read against `0` to `FRACTION_TOLERANCE`, and the drawn position
// against the center of the hex the mote rests on, where "at `t = 1` every mote
// lands exactly" (`specs/simulation.md`, Motion and carrying).
//
// THE MACHINE MUST ACTUALLY MOVE, or the point decides nothing: a build whose
// carries move nothing would leave the mote where it started under any division.
// So the machine is the shortest complete carrying cycle — `grab`, `rotate-cw`,
// `drop`, `rotate-ccw` — and the second under test covers its first three cycles.

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
import { at, hexCenter } from "../field";
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
 * How near a drawn position must land when the fraction behind it agrees to
 * `FRACTION_TOLERANCE`.
 *
 * A mote's `x`, `y` are "derived from ... `sim.fraction`"
 * (`specs/instrumentation.md`), and the fastest thing any motion of
 * `specs/simulation.md` does to a mote over one cycle is carry it once around a
 * circle of the arm's own radius, so a fraction agreeing to `FRACTION_TOLERANCE`
 * puts the position within that circumference times the same figure.
 */
const POSITION_TOLERANCE = 2 * Math.PI * HEX_PITCH * FRACTION_TOLERANCE;

/** The hex the carried mote starts on: the gripper of an arm at ORIGIN, rotation 0. */
const GRIPPED = at(1, 0);

/** Where `rotate-cw` about ORIGIN lands it. */
const CARRIED_TO = at(0, 1);

/** The second under test, and the two ways it is covered. */
const SECONDS = 1;
const DIVISIONS = [1, 60] as const;

/**
 * Everything the specification lists as decided by the interval, at the figures
 * the rules fix for one second of the carrying machine.
 */
const EXPECTED = {
  status: "running",
  cycle: SPEEDS[DEFAULT_SPEED_INDEX],
  speed: DEFAULT_SPEED_INDEX,
  completed: false,
  motes: [{ q: CARRIED_TO.q, r: CARRIED_TO.r, type: "sol" }],
  filaments: 0,
  poses: [{ part: 0, rotation: 1, length: 1 }],
  grips: [],
  tallies: [0],
  area: 3,
  fault: null,
};

/** The same reading off a snapshot, in the terms `EXPECTED` is written in. */
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

/** Hold one division's reading to the state the specification fixes. */
function assertReached(
  snapshot: OrrerySnapshot,
  parts: readonly number[],
  frames: number,
): void {
  const covered = `a second covered by ${String(frames)} frame(s)`;
  assertNotNull(snapshot.sim, `the run is live after ${covered}`);
  assertEqual(
    moteAt(snapshot, CARRIED_TO)?.type,
    "sol",
    `grab, rotate-cw and drop carried the mote from (1, 0) to (0, 1) under ${covered}`,
  );
  assertNull(
    moteAt(snapshot, GRIPPED),
    `so nothing is resting on the hex it started on under ${covered}`,
  );
  assertNull(
    heldBy(snapshot, parts[0] ?? -1, 0),
    `and the gripper that carried it is open again under ${covered}`,
  );
  assertDeepEqual(
    decided(snapshot, parts),
    EXPECTED,
    `the cycle count, the pose, the grips, the mote's hex, the filaments, the tally, the area and the fault are the ones three cycles of the tape fix, under ${covered}`,
  );
  assertNear(
    snapshot.sim?.fraction ?? -1,
    0,
    FRACTION_TOLERANCE,
    `sim.fraction, a running sum of the frames' delta times, lands on the boundary to its rounding under ${covered}`,
  );
  const drawn = moteAt(snapshot, CARRIED_TO) ?? { x: NaN, y: NaN };
  const center = hexCenter(CARRIED_TO);
  assertNear(
    drawn.x,
    center.x,
    POSITION_TOLERANCE,
    `at the boundary the mote is drawn at its hex's center x under ${covered}`,
  );
  assertNear(
    drawn.y,
    center.y,
    POSITION_TOLERANCE,
    `and at its center y under ${covered}`,
  );
}

it("reaches the state one second fixes, covered by one frame or by sixty", async () => {
  for (const frames of DIVISIONS) {
    const parts = await poseCarry();
    const opened = await h.snapshot();
    assertEqual(
      opened.sim?.speed,
      DEFAULT_SPEED_INDEX,
      "a run opens at DEFAULT_SPEED_INDEX, which is the speed this second is covered at",
    );
    assertLength(
      parts,
      1,
      "the machine is one arm, and the whole of what the second moves",
    );
    // The finest division is the watchable one, so it is the evidence.
    if (frames === DIVISIONS[DIVISIONS.length - 1]) {
      await captureReplay(h, "divided", () =>
        h.advanceSeconds(SECONDS, frames),
      );
    } else {
      await h.advanceSeconds(SECONDS, frames);
    }
    assertReached(await h.snapshot(), parts, frames);
  }
});
