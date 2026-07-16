// Locomotivation — headless balance harness.
//
// Drives the EXACT core simulation from ../src/sim — no DOM, no rendering, no wall clock —
// at the fixed timestep, so a controller's play maps to a reproducible result. The core is
// deterministic (specs/controls.md), so replaying the same controller decisions reproduces
// the same outcome; that is what lets this harness verify each level's beatability invariant
// (specs/levels.md) and is the surface the Balance phase tunes `../src/levels.ts` against.
//
//   npx tsx sim/run.ts
//
// The harness itself is generic: it steps a level to a terminal phase (won / lost / timeout)
// under a Controller (sim/strategies.ts) and reports the outcome, the clock remaining, and
// lives used. It never mutates the level data — tuning is a data edit in ../src/levels.ts.

import { DT } from "../src/constants";
import { LEVELS } from "../src/levels";
import { buildWorld, noInput, type SimInput, type SimState } from "../src/sim/world";
import { stepSim } from "../src/sim/step";
import type { LevelDef } from "../src/types";

// The sim is a Node dev tool run via `tsx`; the project compiles with `types: []` (no
// @types/node), so declare the tiny slice of Node globals the reports use.
declare const process: { argv: string[]; exit(code: number): never };

/** A controller decides the worker's input each step from the (read-only) sim state. */
export interface Controller {
  /** The bindings-space intent for this step. Read state; never mutate it. */
  next(state: SimState): SimInput;
  /** Optional human label. */
  readonly name?: string;
}

export interface MatchResult {
  levelId: number;
  levelName: string;
  outcome: "won" | "lost" | "timeout";
  failReason?: string;
  /** Shift clock remaining at the terminal phase (0 for a level that idled to the clock end). */
  clockRemaining: number;
  /**
   * Shift clock remaining at the MOMENT the required quota was first satisfied — the true
   * "finished the work with time to spare" margin. For a level with no last train this equals
   * `clockRemaining` (quota completion wins immediately); for a last-train level (which only
   * ends on the clock or a board) this is the meaningful beatability margin, since idling out
   * the remaining seconds would otherwise report a ~0 margin. NaN if the quota was never met.
   */
  clockAtQuota: number;
  clockTotal: number;
  livesUsed: number;
  score: number;
  quotaMet: boolean;
  boarded: boolean;
  uniquesDelivered: number;
  uniquesTotal: number;
  simSeconds: number;
}

/** Run one level under a controller to a terminal phase (or a hard time cap). */
export function runLevel(level: LevelDef, controller: Controller, capSeconds = level.clock + 12): MatchResult {
  const s = buildWorld(level);
  const maxSteps = Math.ceil(capSeconds / DT);
  let boarded = false;
  let clockAtQuota = NaN;
  for (let i = 0; i < maxSteps; i++) {
    const input = s.phase === "playing" ? controller.next(s) : noInput();
    stepSim(s, input, DT);
    if (s.quotaMet && Number.isNaN(clockAtQuota)) clockAtQuota = Math.max(0, s.clock);
    if (s.boardedTrain) boarded = true;
    if (s.phase === "won" || s.phase === "lost") break;
  }
  const outcome = s.phase === "won" ? "won" : s.phase === "lost" ? "lost" : "timeout";
  const uniquesDelivered = Object.values(s.uniquesDelivered).filter(Boolean).length;
  return {
    levelId: level.id,
    levelName: level.name,
    outcome,
    failReason: s.failReason,
    clockRemaining: Math.max(0, s.clock),
    clockAtQuota,
    clockTotal: level.clock,
    livesUsed: level.lives - s.lives,
    score: s.score,
    quotaMet: s.quotaMet,
    boarded,
    uniquesDelivered,
    uniquesTotal: level.uniques.length,
    simSeconds: s.time,
  };
}

/** A compact deterministic fingerprint of a run to the same step count under fixed input. */
export function fingerprint(level: LevelDef, tape: SimInput[]): string {
  const s = buildWorld(level);
  for (const inp of tape) stepSim(s, inp, DT);
  return [
    s.time.toFixed(4),
    s.worker.pos.x.toFixed(3),
    s.worker.pos.y.toFixed(3),
    s.clock.toFixed(3),
    s.lives,
    s.phase,
    s.trains.map((t) => `${t.trackId}@${t.headPos.toFixed(2)}`).join(","),
    JSON.stringify(s.delivered),
  ].join("|");
}

export { LEVELS };
