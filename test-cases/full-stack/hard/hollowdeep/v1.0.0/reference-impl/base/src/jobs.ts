// Hollowdeep — the job queue and its priority order (specs/delvers.md, specs/controls.md).
//
// Work the colony needs done lives as a queue of Jobs; free delvers pull the highest-
// priority job they can reach and do (src/sim.ts does the reach/claim). The board enqueues,
// dedupes (one job per kind+tile), cancels, and releases claims. Priority is a per-kind
// order with two player controls (specs/controls.md): the "builds before digs" toggle
// (`buildsFirst`) and a per-designation `priorityBoost` ("do this now"), both realized by
// orderJobs. Need-driven states (fleeing bad air, resting, eating) preempt jobs entirely
// and are handled per-delver in src/sim.ts, not here.

import type { Job, JobKind } from "./types";

// Base per-kind order (lower index = pulled first). Keeping the colony fed and its material
// flowing (harvest, refine) comes before opening space and construction; hauling is folded
// into the other jobs (ore/material/food are colony stocks — see the README) so there are
// no standalone haul jobs, but the kind is ordered for completeness.
export const PRIORITY: JobKind[] = ["harvest", "refine", "dig", "build", "haul"];
const PRIORITY_BUILD_FIRST: JobKind[] = ["harvest", "refine", "build", "dig", "haul"];

function kindRank(kind: JobKind, buildsFirst: boolean): number {
  const order = buildsFirst ? PRIORITY_BUILD_FIRST : PRIORITY;
  const i = order.indexOf(kind);
  return i < 0 ? order.length : i;
}

// Order a job list for assignment: boosted designations first, then by kind order, then by
// id (stable). Returns a new array; the input is untouched.
export function orderJobs(jobs: Job[], buildsFirst: boolean): Job[] {
  return [...jobs].sort((a, b) => {
    if (a.priorityBoost !== b.priorityBoost) return a.priorityBoost ? -1 : 1;
    const r = kindRank(a.kind, buildsFirst) - kindRank(b.kind, buildsFirst);
    if (r !== 0) return r;
    return a.id - b.id;
  });
}

export class JobBoard {
  jobs: Job[] = [];
  private nextId = 1;

  get list(): Job[] {
    return this.jobs;
  }

  // Enqueue a job, deduped by kind+tile (a second dig on an already-marked tile is ignored).
  // Returns the created (or existing) job.
  add(kind: JobKind, tx: number, ty: number, building?: Job["building"]): Job {
    const existing = this.at(tx, ty, kind);
    if (existing) return existing;
    const job: Job = {
      id: this.nextId++,
      kind,
      tx,
      ty,
      building,
      claimedBy: null,
      priorityBoost: false,
    };
    this.jobs.push(job);
    return job;
  }

  at(tx: number, ty: number, kind?: JobKind): Job | null {
    for (const j of this.jobs) {
      if (j.tx === tx && j.ty === ty && (kind === undefined || j.kind === kind)) return j;
    }
    return null;
  }

  has(tx: number, ty: number, kind: JobKind): boolean {
    return this.at(tx, ty, kind) !== null;
  }

  // Release any claim a delver holds (it dropped the job — died, or a need preempted it).
  releaseClaimsOf(delverId: number): void {
    for (const j of this.jobs) if (j.claimedBy === delverId) j.claimedBy = null;
  }

  // Remove a finished job.
  remove(job: Job): void {
    const i = this.jobs.indexOf(job);
    if (i >= 0) this.jobs.splice(i, 1);
  }

  // Cancel every job at a tile (a dig designation or a build ghost was cleared). Returns the
  // removed jobs so the caller can free any delver that had claimed one.
  cancelAt(tx: number, ty: number): Job[] {
    const removed = this.jobs.filter((j) => j.tx === tx && j.ty === ty);
    if (removed.length) this.jobs = this.jobs.filter((j) => j.tx !== tx || j.ty !== ty);
    return removed;
  }

  clear(): void {
    this.jobs = [];
    this.nextId = 1;
  }
}
