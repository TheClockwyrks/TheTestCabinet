// Orrery — the run: its lifecycle, its clock, and what a boundary settles
// (specs/simulation.md).
//
// A run is `state.sim`, and it is `null` while editing. Starting one takes
// every arm and wheel to its rest pose holding nothing, raises every wheel's
// six fixtures, settles the field with one pass of the boundary sequence, and
// begins cycle `0`. Stopping one discards the motes and every runtime pose and
// hands the machine back to the editor exactly as it was placed.
//
// THE CLOCK IS THE DETERMINISTIC CORE. A run advances by `SPEEDS[sim.speed]`
// cycles per second of game time, and each cycle is resolved in full at the
// moment it begins, so an interval of game time reaches the same state however
// it was divided into frames: `advance(1, 1)` and `advance(1, 60)` are the same
// run (specs/instrumentation.md "A deterministic core"). Nothing here reads the
// canvas, the wall clock, or a random number; `sim.fraction` exists so a frame
// can DRAW the motion, never so the simulation can decide with it.
//
// A faulting cycle is a cycle whose plan names a sample fraction. The clock
// carries the run up to exactly that fraction and freezes it there, so the run
// stops at the sample the collision rule found rather than at wherever a frame
// happened to land.

import { CUES, DEFAULT_SPEED_INDEX, SPEEDS } from "./constants";
import type { OrreryHost } from "./host";
import { runSigilsSetsAndRises } from "./boundary";
import { planCycle } from "./cycle";
import { hexCenter, sameHex } from "./hex";
import { cloneMachine, machinePeriod } from "./machine";
import {
  armGripperHexes,
  isArmKind,
  machineCost,
  partHexes,
  wheelFixture,
  wheelSpokeHexes,
} from "./parts";
import { moteStagePosition } from "./cycle";
import type { StagePoint } from "./motion";
import { type OrreryState, emptySim, markSolved, recordsOf } from "./state";
import type { SimContext } from "./simcontext";
import type {
  CyclePlan,
  Fault,
  Hex,
  Metrics,
  MoteState,
  PartState,
  SimState,
} from "./types";

/** Everything a run needs to be started, stepped, and stopped. */
export type RunHost = OrreryHost;

/** The context a cycle and a boundary run through, or `null` with no run. */
export function simContext(host: RunHost): SimContext | null {
  const { state } = host;
  if (state.sim === null || state.challenge === null) return null;
  return {
    state,
    sim: state.sim,
    challenge: state.challenge,
    parts: state.editor.parts,
    cue: (cue) => host.cue(cue),
    effect: (system, at) => host.effect(system, at),
  };
}

/**
 * Start a run on the machine as placed (specs/simulation.md "The run"). The
 * readiness condition the `play` action applies belongs to the editor, so a
 * run started from the debug surface starts on any machine at all.
 */
export function startRun(host: RunHost): void {
  const { state } = host;
  if (state.challenge === null)
    throw new Error("startRun: no challenge is open");
  const sim = emptySim(state.challenge.products.length);
  state.sim = sim;
  // 1. Every arm and wheel at its rest pose, holding nothing, and every
  //    wheel's six fixtures on its spoke hexes.
  for (const part of state.editor.parts) {
    if (!isArmKind(part.kind) && part.kind !== "wheel") continue;
    sim.poses.push({
      part: part.id,
      rotation: part.rotation,
      length: part.length,
      cell: { q: part.q, r: part.r },
    });
    if (part.kind === "wheel") raiseFixtures(sim, part);
  }
  seedAreaBank(sim, state);
  // 2. The settle: one pass of the boundary sequence, on a field holding only
  //    fixtures.
  const context = simContext(host);
  if (context !== null) runBoundary(context);
  // 3. The cycle counter starts at 0 and the machine begins cycle 0.
  sim.cycle = 0;
  sim.fraction = 0;
  sim.speed = DEFAULT_SPEED_INDEX;
  sim.pending = null;
}

/** Stop a run and hand the machine back to the editor exactly as placed. */
export function stopRun(state: OrreryState): void {
  state.sim = null;
}

/** Raise one wheel's six fixtures, on its spoke hexes, in the `WHEEL_MOTES` ring. */
export function raiseFixtures(sim: SimState, wheel: PartState): void {
  const hexes = wheelSpokeHexes({ q: wheel.q, r: wheel.r });
  for (let spoke = 0; spoke < 6; spoke += 1) {
    const mote: MoteState = {
      id: sim.nextMoteId,
      q: hexes[spoke].q,
      r: hexes[spoke].r,
      type: wheelFixture(spoke, wheel.rotation),
      wheel: wheel.id,
    };
    sim.nextMoteId += 1;
    sim.motes.push(mote);
  }
}

/**
 * The area bank at the start of a run: every hex of every placed part, every
 * fixture hex, and every gripper hex at rest (specs/simulation.md).
 */
function seedAreaBank(sim: SimState, state: OrreryState): void {
  for (const part of state.editor.parts) {
    for (const cell of partHexes(part, state.challenge)) bankHex(sim, cell);
  }
  for (const mote of sim.motes) {
    if (mote.wheel !== null) bankHex(sim, { q: mote.q, r: mote.r });
  }
  for (const part of state.editor.parts) {
    if (!isArmKind(part.kind)) continue;
    for (const cell of armGripperHexes(
      part.kind,
      { q: part.q, r: part.r },
      part.rotation,
      part.length,
    )) {
      bankHex(sim, cell);
    }
  }
}

/** Add one hex to the area bank, if it is not already banked. */
export function bankHex(sim: SimState, cell: Hex): void {
  if (!sim.areaHexes.some((banked) => sameHex(banked, cell))) {
    sim.areaHexes.push({ q: cell.q, r: cell.r });
  }
}

/**
 * The boundary sequence: the sigil phase, then sets, then rises, then the area
 * bank, then the completion check (specs/simulation.md). Run at every boundary,
 * the settle included.
 */
export function runBoundary(context: SimContext): void {
  runSigilsSetsAndRises(context);
  bankBoundaryHexes(context);
  if (context.state.completion) checkCompletion(context);
}

/** After every boundary: the hex of every mote and of every gripper. */
function bankBoundaryHexes(context: SimContext): void {
  const { sim } = context;
  for (const mote of sim.motes) bankHex(sim, { q: mote.q, r: mote.r });
  for (const pose of sim.poses) {
    const part = context.parts.find((entry) => entry.id === pose.part);
    if (part === undefined || !isArmKind(part.kind)) continue;
    for (const cell of armGripperHexes(
      part.kind,
      pose.cell,
      pose.rotation,
      pose.length,
    )) {
      bankHex(sim, cell);
    }
  }
}

/** Which product indices the machine has a set placed for. */
export function placedSetIndices(parts: readonly PartState[]): number[] {
  const indices: number[] = [];
  for (const part of parts) {
    if (part.kind === "set" && part.index !== null) indices.push(part.index);
  }
  return indices;
}

/**
 * Complete the run when every placed set's tally has reached the challenge's
 * target (specs/simulation.md "Completion and metrics"). A run whose machine
 * holds no set never completes, and the completion switch of
 * specs/instrumentation.md holds the whole check off.
 */
export function checkCompletion(context: SimContext): void {
  const { sim, state, challenge } = context;
  const sets = placedSetIndices(context.parts);
  if (sets.length === 0) return;
  if (!sets.every((index) => (sim.tallies[index] ?? 0) >= challenge.target)) {
    return;
  }
  sim.status = "complete";
  sim.fraction = 0;
  sim.pending = null;
  // The solved panel is arrived at here, and its menu opens on its first item
  // whatever the last menu the player left behind (specs/ui.md).
  state.menuIndex = 0;
  sim.metrics = {
    cost: machineCost(context.parts),
    cycles: sim.cycle + 1,
    area: sim.areaHexes.length,
  };
  context.cue(CUES.complete);
  // The completion effect plays over the middle of the field (specs/assets.md).
  context.effect("complete", hexCenter({ q: 0, r: 0 }));
  recordCompletion(state, sim.metrics);
}

/**
 * A completed run marks its challenge solved, unlocks what its mode unlocks,
 * and lowers each of its three records independently
 * (specs/modes/campaign.md, specs/modes/extras.md). A challenge loaded directly
 * through the debug surface belongs to no course, so it touches nothing.
 */
export function recordCompletion(state: OrreryState, metrics: Metrics): void {
  const ref = state.challengeRef;
  if (ref === null) return;
  markSolved(state, ref.mode, ref.index);
  if (ref.mode === "campaign") {
    state.unlockedCount = Math.min(
      Math.max(state.unlockedCount, ref.index + 2),
      Math.max(1, state.campaignRecords.length),
    );
  }
  const records = recordsOf(state, ref.mode);
  const standing = records[ref.index] ?? null;
  records[ref.index] =
    standing === null
      ? { ...metrics }
      : {
          cost: Math.min(standing.cost, metrics.cost),
          cycles: Math.min(standing.cycles, metrics.cycles),
          area: Math.min(standing.area, metrics.area),
        };
}

/** The most cycles one call may run, so a runaway `dt` cannot hang a frame. */
const MAX_CYCLES_PER_CALL = 100_000;

/**
 * How near a cycle boundary counts as standing on it, in cycles.
 *
 * specs/instrumentation.md requires that an interval of game time reach the
 * same state however it was divided into frames: "`advance(1, 1)` and
 * `advance(1, 60)` cover the same cycles and reach the same outcome".
 * The rule those two must agree on is real arithmetic, but the clock adds
 * `SPEEDS[speed] * dt` in binary floating point, and a sum of sixty such terms
 * is not bit-identical to the single term covering the same span. One second
 * at speed `1` is three cycles either way in exact arithmetic; in floats the
 * divided one can land at `2.999999999999999`, one cycle short.
 *
 * So the boundary is tested with a tolerance, at both ends. A span that comes
 * within `CYCLE_EPSILON` of finishing a cycle finishes it, and the residue
 * left over after crossing one is dropped rather than spent on beginning the
 * next. Both matter: the first keeps the cycle COUNT, and with it every
 * outcome the run turns on, independent of the frame division; the second
 * keeps a residue of a few ulps from BEGINNING the following cycle, which
 * resolves its fetch, drops, and grabs and so would show up in `sim.grips`.
 * Neither accumulates — crossing re-seats the fraction on an exact `0`, so a
 * long run cannot drift.
 *
 * The fraction WITHIN a cycle keeps its residue, since the rule it follows is
 * the running sum itself. That residue is of order `1e-13` of a cycle and
 * reaches `sim.fraction` and the drawn positions derived from it alone, never
 * a cycle's outcome.
 *
 * `1e-9` cycles is a nanosecond of game time at `SPEEDS[0]`, and a
 * thirtieth of one at `SPEEDS[3]` — far below anything a frame can express,
 * and far above the float noise measured across the reference solutions
 * (about `1e-12` cycles over a run).
 */
const CYCLE_EPSILON = 1e-9;

/**
 * Advance the run by `dt` seconds of game time, at the speed step it stands
 * at. Whole cycles run in order and in full, and the excess carries into the
 * next one, so the outcome never depends on where a frame boundary fell.
 */
export function advanceRun(host: RunHost, dt: number): void {
  if (!(dt > 0)) return;
  const context = simContext(host);
  if (context === null) return;
  advanceCycles(context, SPEEDS[context.sim.speed] * dt);
}

/** Advance the run by a number of cycles of simulated machine time. */
export function advanceCycles(context: SimContext, cycles: number): void {
  const { sim } = context;
  let remaining = cycles;
  let guard = 0;
  while (
    remaining > CYCLE_EPSILON &&
    sim.status === "running" &&
    guard < MAX_CYCLES_PER_CALL
  ) {
    const plan = beginCycle(context);
    if (sim.status !== "running") return;
    // A faulting cycle runs only as far as the sample its fault names.
    const limit = plan.fault === null ? 1 : plan.fault.fraction;
    const toLimit = limit - sim.fraction;
    if (remaining < toLimit - CYCLE_EPSILON) {
      sim.fraction += remaining;
      return;
    }
    remaining -= toLimit;
    sim.fraction = limit;
    if (plan.fault !== null) {
      raiseFault(context, plan);
      return;
    }
    closeCycle(context, plan);
    guard += 1;
  }
}

/**
 * Resolve the cycle now running, once, at the moment it begins: fetch, drops,
 * grabs, and the motion sweep with its torn check and its collision samples.
 */
function beginCycle(context: SimContext): CyclePlan {
  const { sim } = context;
  if (sim.pending === null) sim.pending = planCycle(context);
  return sim.pending;
}

/**
 * Freeze the run at the fraction its fault names. The cycle's plan is KEPT, so
 * the frozen frame draws every mote where the fault found it: a collision at
 * `k / 8` leaves the two motes that met on the arc rather than back on the
 * hexes they left (specs/simulation.md "A fault freezes the run where it
 * stood"). Nothing advances afterwards, so the plan is never resumed.
 */
function raiseFault(context: SimContext, plan: CyclePlan): void {
  const { sim } = context;
  if (plan.fault === null) return;
  sim.status = "faulted";
  sim.fault = plan.fault.fault;
  context.cue(CUES.halt);
  context.effect("fault", faultPosition(context, plan.fault.fault));
}

/**
 * Where the fault effect plays: the position of the mote the fault names,
 * lowest in `y` and then lowest in `x` among them, and the anchor hex of the
 * part it names when it names no mote (specs/assets.md "The particle effects").
 */
function faultPosition(context: SimContext, fault: Fault): StagePoint {
  const { sim } = context;
  let lowest: StagePoint | null = null;
  for (const id of fault.motes) {
    const mote = sim.motes.find((entry) => entry.id === id);
    if (mote === undefined) continue;
    const at = moteStagePosition(mote, sim);
    if (
      lowest === null ||
      at.y < lowest.y ||
      (at.y === lowest.y && at.x < lowest.x)
    ) {
      lowest = at;
    }
  }
  if (lowest !== null) return lowest;
  const part = context.parts.find((entry) => fault.parts.includes(entry.id));
  return hexCenter(
    part === undefined ? { q: 0, r: 0 } : { q: part.q, r: part.r },
  );
}

/** Land the cycle's motion, run the boundary, and begin the next cycle. */
function closeCycle(context: SimContext, plan: CyclePlan): void {
  const { sim } = context;
  plan.land();
  sim.pending = null;
  runBoundary(context);
  if (sim.status !== "running") {
    // A completing or faulting boundary leaves the fraction at `0` and the
    // cycle count at the cycle just run.
    sim.fraction = 0;
    return;
  }
  sim.cycle += 1;
  sim.fraction = 0;
}

/**
 * Run the machine to the next boundary and leave it paused there
 * (specs/editor.md "Running the machine"): a run mid-cycle completes its
 * current cycle, and a run at a boundary runs one full cycle. `step` always
 * leaves the run paused.
 */
export function stepOneCycle(host: RunHost): void {
  const context = simContext(host);
  if (context === null) return;
  const { sim } = context;
  if (sim.status !== "running" && sim.status !== "paused") return;
  sim.status = "running";
  advanceCycles(context, 1 - sim.fraction);
  if (sim.status === "running") sim.status = "paused";
}

/** The machine's period, as the readout and the snapshot report it. */
export function periodOf(state: OrreryState): number {
  return machinePeriod(state.editor.parts);
}

/** The machine the editor is holding, copied, for a per-challenge stash. */
export function machineSnapshot(state: OrreryState): PartState[] {
  return cloneMachine(state.editor.parts);
}
