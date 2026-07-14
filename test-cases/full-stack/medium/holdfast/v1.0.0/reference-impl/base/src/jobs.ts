// Holdfast — the job system (DESIGN §4, specs/settlers.md, specs/economy.md).
//
// Work exists as a queue of jobs the colony needs done; settlers pull from it. Each tick
// regenJobs rebuilds the UNCLAIMED half of the queue from the world (designated nodes,
// build ghosts, farm plots to sow/harvest, cook opportunities, dropped piles to haul, and
// downed allies to tend), leaving CLAIMED jobs — the ones a settler is walking to or working
// on — untouched so no progress is lost. assignJob hands a free settler the highest-priority
// job it is allowed (the work-priority grid), able, and able to reach, with no two settlers
// on the same job. advanceJob runs a claimed job forward once the settler has arrived,
// draining persistent counters (a node's remaining work, a structure's build progress) and
// applying the yield on completion. The module is DOM-free and side-effects only through
// the small set of Game helpers it calls.

import {
  COOK_IN,
  COOK_OUT,
  COOK_TIME,
  HARVEST_TIME,
  HARVEST_YIELD,
  HAUL_PICKUP,
  MOOD_SLOW,
  MOOD_SLOW_MUL,
  SOW_TIME,
  STRUCTURES,
  TEND_TIME,
  DOWNED_RECOVER_HP,
  CHOP_YIELD,
  MINE_YIELD,
  skillMul,
  type JobKind,
  type Skill,
  type WorkType,
} from "./constants";
import { reachableAdjacent } from "./pathfind";
import { tileCenterX, tileCenterY, tileOfPixelX, tileOfPixelY } from "./world";
import type { Job, Settler } from "./types";
import type { Game } from "./sim";

// Which work-priority-grid column gates each job kind. eat/sleep/fight never enter the
// queue (needs and combat are handled directly in the sim); tend is a rescue that bypasses
// the grid (always allowed) — its entry here is a filler the sim does not consult.
export const WORK_OF: Record<JobKind, WorkType> = {
  chop: "gather",
  mine: "gather",
  haul: "haul",
  build: "build",
  cook: "cook",
  sow: "farm",
  harvest: "farm",
  fight: "fight",
  tend: "build",
  eat: "cook",
  sleep: "build",
};

// The skill that governs a job's work speed (haul/tend have none → flat 1.0×).
function jobSkill(kind: JobKind): Skill | null {
  switch (kind) {
    case "chop":
      return "chop";
    case "mine":
      return "mine";
    case "build":
      return "build";
    case "cook":
      return "cook";
    case "sow":
    case "harvest":
      return "farm";
    default:
      return null;
  }
}

function workRate(settler: Settler, kind: JobKind): number {
  const sk = jobSkill(kind);
  const base = sk ? skillMul(settler.skills[sk]) : 1;
  const moodMul = settler.needs.mood < MOOD_SLOW ? MOOD_SLOW_MUL : 1; // a moody settler works slowly
  return base * moodMul;
}

let nextJobId = 0; // only used to keep unclaimed rebuilds cheap; identity is by key otherwise

function makeJob(kind: JobKind, tx: number, ty: number, extra: Partial<Job> = {}): Job {
  nextJobId++;
  return { kind, tx, ty, claimedBy: null, work: 0, workNeeded: 0, ...extra };
}

// A stable key for a work source, so a claimed job already covering it is not duplicated.
function sourceKey(kind: JobKind, tx: number, ty: number, targetId?: number): string {
  if (kind === "haul" || kind === "tend") return `${kind}:${targetId}`;
  return `${kind}:${tx}:${ty}`;
}
function jobKey(j: Job): string {
  return sourceKey(j.kind, j.tx, j.ty, j.targetId);
}

// ---- Regenerate the open queue -------------------------------------------------
export function regenJobs(game: Game): void {
  const claimed = game.jobs.filter((j) => j.claimedBy !== null);
  const covered = new Set(claimed.map(jobKey));
  const next: Job[] = [...claimed];
  const add = (j: Job): void => {
    const k = jobKey(j);
    if (covered.has(k)) return;
    covered.add(k);
    next.push(j);
  };

  // Designated nodes → chop / mine.
  for (const t of game.world.tiles) {
    if (t.node && t.designated) {
      add(makeJob(t.designated, t.x, t.y, { workNeeded: t.node.maxHp }));
    }
  }

  // Structures: ghosts to build, farm plots to sow/harvest, stoves with a cook opportunity.
  for (const s of game.structures) {
    if (!s.built) {
      add(makeJob("build", s.tx, s.ty, { structure: s, workNeeded: STRUCTURES[s.kind].buildTime }));
      continue;
    }
    if (s.kind === "farm") {
      if (s.cropStage === 0) add(makeJob("sow", s.tx, s.ty, { structure: s, workNeeded: SOW_TIME }));
      else if (s.cropStage === 2) add(makeJob("harvest", s.tx, s.ty, { structure: s, workNeeded: HARVEST_TIME }));
    } else if (s.kind === "stove" && game.stock.crops >= COOK_IN) {
      add(makeJob("cook", s.tx, s.ty, { structure: s, workNeeded: COOK_TIME }));
    }
  }

  // Dropped piles → haul to the stockpile.
  for (const d of game.drops) {
    add(makeJob("haul", d.tx, d.ty, { targetId: d.id, workNeeded: HAUL_PICKUP }));
  }

  // Downed allies → tend (rescue).
  for (const s of game.settlers) {
    if (s.downed && !s.dead) add(makeJob("tend", tileOfPixelX(s.x), tileOfPixelY(s.y), { targetId: s.id, workNeeded: TEND_TIME }));
  }

  game.jobs = next;
}

// ---- Assignment ----------------------------------------------------------------
export function assignJob(game: Game, settler: Settler): Job | null {
  const from = game.tileOf(settler);
  const moodLow = settler.needs.mood < MOOD_SLOW;
  let best: { job: Job; prio: number; dist: number; path: { tx: number; ty: number }[] } | null = null;

  for (const job of game.jobs) {
    if (job.claimedBy !== null) continue;
    let prio: number;
    if (job.kind === "tend") {
      prio = 100; // a downed colonist outranks ordinary work
    } else {
      const p = game.priorityOf(settler.id, WORK_OF[job.kind]);
      if (p <= 0) continue; // switched off for this settler
      if (moodLow && p === 1) continue; // a moody settler refuses the lowest-priority work
      prio = p;
    }
    const path = reachableAdjacent(game.world, from, { tx: job.tx, ty: job.ty });
    if (path === null) continue; // cannot reach it right now
    const dist = path.length;
    if (!best || prio > best.prio || (prio === best.prio && dist < best.dist)) {
      best = { job, prio, dist, path };
    }
  }

  if (!best) return null;
  best.job.claimedBy = settler.id;
  settler.job = best.job;
  settler.path = best.path;
  settler.pathIdx = 0;
  return best.job;
}

// ---- Work progress (called once the settler has arrived at the work tile) ------
// Returns true when the job finished (the settler should look for the next one).
export function advanceJob(game: Game, settler: Settler, dt: number): boolean {
  const job = settler.job;
  if (!job) return true;
  const rate = workRate(settler, job.kind);

  switch (job.kind) {
    case "chop":
    case "mine":
      return advanceGather(game, settler, job, dt * rate);
    case "build":
      return advanceBuild(game, settler, job, dt * rate);
    case "cook":
      return advanceTimed(game, settler, job, dt * rate, () => {
        if (game.stock.crops >= COOK_IN) {
          game.stock.crops -= COOK_IN;
          game.stock.meals += COOK_OUT;
        }
        if (job.structure) job.structure.active = false;
        game.growSkill(settler, "cook");
        game.pushCue("build");
      }, () => {
        if (job.structure) job.structure.active = true;
      });
    case "sow":
      return advanceTimed(game, settler, job, dt * rate, () => {
        if (job.structure) {
          job.structure.cropStage = 1;
          job.structure.growth = 0;
        }
        game.growSkill(settler, "farm");
      });
    case "harvest":
      return advanceTimed(game, settler, job, dt * rate, () => {
        if (job.structure) {
          game.addDrop(job.structure.tx, job.structure.ty, "crops", HARVEST_YIELD);
          job.structure.cropStage = 1; // resown — the plot grows again (DESIGN §3.5)
          job.structure.growth = 0;
        }
        game.growSkill(settler, "farm");
        game.pushFx("dust", tileCenterX(job.tx), tileCenterY(job.ty));
      });
    case "tend":
      return advanceTend(game, settler, job, dt);
    case "haul":
      return advanceHaul(game, settler, job, dt);
    case "eat":
      return advanceTimed(game, settler, job, dt, () => {
        if (game.stock.meals > 0) game.stock.meals -= 1;
        settler.needs.hunger = 0;
      });
    default:
      return true; // fight/sleep are not queue jobs
  }
}

// Chop / mine: drain the node's remaining work (its hp), puff dust as it is worked, and on
// clearing turn the tile back to walkable ground and drop the yield at the node.
function advanceGather(game: Game, settler: Settler, job: Job, work: number): boolean {
  const tile = game.world.tileAt(job.tx, job.ty);
  if (!tile || !tile.node || !tile.designated) return true; // source gone → drop the job
  const before = tile.node.workAnim;
  tile.node.workAnim += work;
  if (Math.floor(tile.node.workAnim * 2) !== Math.floor(before * 2)) {
    game.pushFx("dust", tileCenterX(job.tx), tileCenterY(job.ty)); // construction/impact puff
  }
  tile.node.hp -= work;
  if (tile.node.hp > 0) return false;

  const kind = tile.node.kind;
  const res = kind === "tree" ? "wood" : "ore";
  const amount = kind === "tree" ? CHOP_YIELD : MINE_YIELD;
  tile.node = null;
  tile.designated = null;
  game.world.recompute(tile);
  game.addDrop(job.tx, job.ty, res, amount);
  game.growSkill(settler, kind === "tree" ? "chop" : "mine");
  game.pushFx("dust", tileCenterX(job.tx), tileCenterY(job.ty));
  return true;
}

// Build: advance the structure's own persistent progress so a builder who wanders off does
// not reset the wall; on completion the ghost becomes the finished structure.
function advanceBuild(game: Game, settler: Settler, job: Job, work: number): boolean {
  const s = job.structure;
  if (!s || s.built) return true;
  s.progress += work / Math.max(0.01, STRUCTURES[s.kind].buildTime);
  if (s.progress < 1) return false;
  s.progress = 1;
  game.finishStructure(s);
  game.growSkill(settler, "build");
  return true;
}

// Cook / sow / harvest / eat: accumulate seconds of work; `onStart` fires the first tick (to
// light the stove), `onDone` applies the yield.
function advanceTimed(_game: Game, _settler: Settler, job: Job, work: number, onDone: () => void, onStart?: () => void): boolean {
  if (job.work === 0 && onStart) onStart();
  job.work += work;
  if (job.work < job.workNeeded) return false;
  onDone();
  return true;
}

// Tend: stabilize a downed ally — stop the bleed and bring it back to its feet at a reduced
// health (specs/combat.md). Drops the job if the ally died or was already tended.
function advanceTend(_game: Game, _settler: Settler, job: Job, dt: number): boolean {
  const ally = _game.settlerById(job.targetId ?? -1);
  if (!ally || ally.dead || !ally.downed) return true;
  job.work += dt;
  if (job.work < job.workNeeded) return false;
  ally.downed = false;
  ally.bleed = 0;
  ally.health = DOWNED_RECOVER_HP;
  ally.activity = "idle";
  _game.pushCue("build");
  return true;
}

// Haul: two phases. Walk to the pile and pick it up (removing it from the ground), then
// carry it to the stockpile and deposit it into the stock. The claimed job survives the
// pile's removal because regenJobs never rebuilds claimed jobs.
function advanceHaul(game: Game, settler: Settler, job: Job, dt: number): boolean {
  if (!settler.carrying) {
    const drop = game.dropById(job.targetId ?? -1);
    if (!drop) return true; // someone already took it
    job.work += dt;
    if (job.work < job.workNeeded) return false;
    settler.carrying = { res: drop.res, amount: drop.amount };
    game.removeDrop(drop.id);
    settler.activity = "haul";
    game.pathTo(settler, game.world.stockpile); // now carry it home
    return false;
  }
  // Carrying: this call means the settler reached the stockpile.
  game.stock[settler.carrying.res] += settler.carrying.amount;
  settler.carrying = null;
  return true;
}
