// Orrery — the drop and grab steps, and the motion each held constellation
// takes (specs/simulation.md, steps 2 and 3 of the cycle, and "Held more than
// once").
//
// Drops run before grabs, and both run before anything moves, so a gripper
// whose cell is `grab` is holding for THIS cycle's motion rather than the next
// one. A gripper closing over a mote takes hold of that mote's CONSTELLATION,
// which is never stored: `sim.grips` records the one mote under each closed
// gripper and the group is walked from `sim.filaments` at the moment it is
// asked for, so a filament made or broken at a boundary changes what a standing
// grip carries with no grip to keep in step.
//
// A grip persists across cycles until the part that holds it executes `drop`.
// Nothing here expires one, and the motion step below reads whatever
// `sim.grips` holds, which is what makes a grip taken once ride every following
// cycle.
//
// The agreement rule is the other half of this module. A constellation may be
// held by several grippers at once, freely, and at the START of the motion step
// every holder's imposed motion must be the same one — all no motion, all the
// same translation, or all rotation about one center in one direction. When
// they are not, the run tears, and it tears BEFORE anything moves, so the fault
// freezes the field exactly as the boundary left it.

import { constellations } from "./constellation";
import { imposedMotion, type PartStep } from "./fetch";
import { sameHex } from "./hex";
import { REST, sameMotion, type Motion } from "./motion";
import { armSpokes, gripperHex, isArmKind } from "./parts";
import type { Fault, MoteState, PartState, SimState } from "./types";

/** Open every gripper of every part whose instruction for this cycle is `drop`. */
export function applyDrops(sim: SimState, steps: readonly PartStep[]): void {
  const opening = new Set(
    steps.filter((step) => step.cell === "drop").map((step) => step.part.id),
  );
  if (opening.size === 0) return;
  sim.grips = sim.grips.filter((grip) => !opening.has(grip.part));
}

/**
 * Close every gripper of every part whose instruction for this cycle is `grab`.
 * A gripper over a mote that is not a fixture takes hold of it; a gripper over
 * a fixture or over nothing closes on nothing, leaving that spoke holding
 * nothing at all.
 */
export function applyGrabs(sim: SimState, steps: readonly PartStep[]): void {
  for (const step of steps) {
    if (step.cell !== "grab" || !isArmKind(step.part.kind)) continue;
    for (const spoke of armSpokes(step.part.kind, step.pose.rotation)) {
      const at = gripperHex(step.pose.cell, spoke, step.pose.length);
      const taken = graspable(sim, at);
      sim.grips = sim.grips.filter(
        (grip) => grip.part !== step.part.id || grip.spoke !== spoke,
      );
      if (taken !== null) {
        sim.grips.push({ part: step.part.id, spoke, mote: taken.id });
      }
    }
  }
}

/** The mote a gripper standing on `at` may take: a real mote, never a fixture. */
function graspable(
  sim: SimState,
  at: { q: number; r: number },
): MoteState | null {
  return (
    sim.motes.find((mote) => mote.wheel === null && sameHex(mote, at)) ?? null
  );
}

/** The motion every mote takes this cycle, or the tear that stops the cycle. */
export interface HeldMotions {
  /** The motion imposed on each mote, by mote id; an absent mote rests. */
  readonly motions: Map<number, Motion>;
  /** The tear the holders' disagreement raises, or `null`. */
  readonly torn: Fault | null;
}

/**
 * Resolve what each mote does this cycle. Fixtures are carried by their wheel's
 * rotation and rest otherwise; every held constellation takes the one motion
 * its holders agree on; and every other mote rests on its hex for the whole
 * cycle.
 */
export function heldMotions(
  sim: SimState,
  parts: readonly PartState[],
  steps: readonly PartStep[],
): HeldMotions {
  const byPart = new Map(steps.map((step) => [step.part.id, step]));
  const motions = new Map<number, Motion>();
  for (const mote of sim.motes) {
    if (mote.wheel === null) continue;
    const wheel = byPart.get(mote.wheel);
    motions.set(mote.id, wheel?.carried ?? REST);
  }
  for (const group of constellations(sim)) {
    const holders = sim.grips.filter((grip) => group.includes(grip.mote));
    if (holders.length === 0) continue;
    const imposed = holders.map((grip) => {
      const step = byPart.get(grip.part);
      return step === undefined ? REST : imposedMotion(step, grip.spoke);
    });
    const agreed = imposed[0];
    if (!imposed.every((motion) => sameMotion(motion, agreed))) {
      const holding = new Set(holders.map((grip) => grip.part));
      return {
        motions,
        torn: {
          kind: "torn",
          parts: parts
            .filter((part) => holding.has(part.id))
            .map((part) => part.id),
          motes: [...group],
        },
      };
    }
    for (const mote of group) motions.set(mote, agreed);
  }
  return { motions, torn: null };
}
