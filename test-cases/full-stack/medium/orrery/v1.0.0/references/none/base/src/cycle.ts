// Orrery — one cycle of the machine, and the boundary sequence that closes it
// (specs/simulation.md).
//
// A cycle is resolved ATOMICALLY, at the moment it begins. The five steps of
// the specification run here in their stated order — fetch, drops, grabs,
// motion, boundary — and the first four of them are `planCycle` below: fetch
// reads every tape cell and may halt the cycle before a gripper moves, drops
// open, grabs close, and the motion step is planned in full, with the torn
// check at its start and the collision check at each of the eight sample
// fractions. What the clock in `src/sim.ts` then does is sweep `sim.fraction`
// from `0` to `1` so the frame can DRAW the motion, and apply the plan's
// landing when it reaches the boundary.
//
// Resolving the cycle at its start rather than at its end is what makes the
// run frame-division independent, which specs/instrumentation.md requires: the
// outcome is a function of the machine and the cycle number, never of how many
// frames happened to cross the cycle. A faulting cycle is frozen at the sample
// fraction the fault names, whatever frame reached it.
//
// The plan is also where the DRAWN position of a mote comes from. Every mote's
// motion for the cycle is recorded once, so `moteStagePosition` is a lookup at
// whatever fraction the run has reached rather than a second, parallel
// derivation that could drift from the one the collision rule used.
//
// SEAM: the sigil phase of the boundary is the one part of the sequence still
// to be written. `runSigilsSetsAndRises` is where the four waves, the sets, and
// the rises of specs/sigils.md go; the area bank and the completion check
// around it are in `src/sim.ts` and already run at every boundary.

import { firstCollisionSample, type MotePoint } from "./collision";
import { fetchCycle, type PartStep } from "./fetch";
import { applyDrops, applyGrabs, heldMotions } from "./grips";
import { hexCenter } from "./hex";
import { landHex, movePoint, REST, type Motion } from "./motion";
import type { SimContext } from "./simcontext";
import type { CyclePlan, Fault, Hex, MoteState, SimState } from "./types";

/** What one mote does over one cycle: where it began, its motion, where it lands. */
export interface MoteMotion {
  readonly mote: number;
  readonly from: Hex;
  readonly motion: Motion;
  readonly to: Hex;
}

/** A cycle that does nothing and faults on nothing. */
export const IDLE_CYCLE: CyclePlan = {
  fault: null,
  land: (): void => {},
  position: (): null => null,
};

/**
 * Resolve the cycle `ctx.sim.cycle` is about to run: fetch, drops, grabs, and
 * the motion sweep with its torn check and its collision samples.
 *
 * The steps run in the specification's order and stop at the first that halts
 * the cycle. A fetch fault returns before the drops, so no gripper of any part
 * opens or closes; a tear returns after the grabs but before anything moves,
 * because a gripper closing this cycle holds for this cycle's motion.
 */
export function planCycle(ctx: SimContext): CyclePlan {
  const { sim, parts } = ctx;
  // 1. Fetch.
  const fetched = fetchCycle(parts, sim.poses, sim.cycle);
  if (fetched.fault !== null) return haltedPlan(fetched.fault);
  // 2. Drops.
  applyDrops(sim, fetched.steps);
  // 3. Grabs.
  applyGrabs(sim, fetched.steps);
  // 4. Motion, with the torn check at its start.
  const held = heldMotions(sim, parts, fetched.steps);
  if (held.torn !== null) return haltedPlan(held.torn);
  const carried = sim.motes.map((mote) => moteMotion(mote, held.motions));
  return sweptPlan(sim, carried, fetched.steps);
}

/** What one mote does this cycle, from the motions the holders agreed on. */
function moteMotion(mote: MoteState, motions: Map<number, Motion>): MoteMotion {
  const from: Hex = { q: mote.q, r: mote.r };
  const motion = motions.get(mote.id) ?? REST;
  return { mote: mote.id, from, motion, to: landHex(from, motion) };
}

/**
 * Where a mote stands at fraction `t` of its motion. At `t = 1` the landing hex
 * center is reported exactly, so no motion ever leaves a mote between hexes.
 */
export function moteMotionPosition(
  entry: MoteMotion,
  t: number,
): { x: number; y: number } {
  if (t >= 1) return hexCenter(entry.to);
  return movePoint(hexCenter(entry.from), entry.motion, t);
}

/** A cycle halted before it moved: it freezes at fraction `0` and lands nothing. */
function haltedPlan(fault: Fault): CyclePlan {
  return {
    fault: { fault, fraction: 0 },
    land: (): void => {},
    position: (): null => null,
  };
}

/**
 * The motion step's plan: the sweep every mote takes, the collision sample it
 * may freeze at, and the landing that closes the cycle.
 */
function sweptPlan(
  sim: SimState,
  carried: readonly MoteMotion[],
  steps: readonly PartStep[],
): CyclePlan {
  const sample = firstCollisionSample((t) =>
    carried.map((entry): MotePoint => ({
      mote: entry.mote,
      ...moteMotionPosition(entry, t),
    })),
  );
  return {
    fault:
      sample === null
        ? null
        : {
            fault: { kind: "collision", parts: [], motes: sample.motes },
            fraction: sample.fraction,
          },
    land: (): void => {
      landCycle(sim, carried, steps);
    },
    position: (mote, t) => {
      const entry = carried.find((held) => held.mote === mote);
      return entry === undefined ? null : moteMotionPosition(entry, t);
    },
  };
}

/**
 * Land the cycle's motion: every mote onto the hex center its motion carried it
 * to, and every part into the pose its instruction left it in. A mote or a part
 * the run no longer holds is skipped, so a scenario that removed one mid-cycle
 * lands the rest.
 */
function landCycle(
  sim: SimState,
  carried: readonly MoteMotion[],
  steps: readonly PartStep[],
): void {
  for (const entry of carried) {
    const mote = sim.motes.find((held) => held.id === entry.mote);
    if (mote === undefined) continue;
    mote.q = entry.to.q;
    mote.r = entry.to.r;
  }
  for (const step of steps) {
    const pose = sim.poses.find((entry) => entry.part === step.part.id);
    if (pose === undefined) continue;
    pose.rotation = step.next.rotation;
    pose.length = step.next.length;
    pose.cell = { q: step.next.cell.q, r: step.next.cell.r };
  }
}

/**
 * The transforming, binding, sundering, and voiding waves in order, then every
 * set, then every rise, each in reading order (specs/simulation.md "The sigil
 * phase"). Run at every boundary, the settle included, before the area bank
 * and the completion check.
 */
export function runSigilsSetsAndRises(_ctx: SimContext): void {}

/**
 * Where a mote is DRAWN at the run's current fraction: its hex at the last
 * boundary, carried along the motion its cycle imposes (specs/simulation.md
 * "Motion and carrying"). A mote held by nothing rests on its hex for the whole
 * cycle, and so does every mote before a cycle's motion has been resolved.
 */
export function moteStagePosition(
  mote: MoteState,
  sim: SimState,
): { x: number; y: number } {
  const at = sim.pending?.position(mote.id, sim.fraction) ?? null;
  return at ?? hexCenter({ q: mote.q, r: mote.r });
}
