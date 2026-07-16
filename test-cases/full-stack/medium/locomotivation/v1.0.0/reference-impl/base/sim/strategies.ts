// Locomotivation — headless controllers for the balance harness (sim/harness.ts).
//
// The `RouteController` EXECUTES a scripted route (sim/routes.ts) against the pure core: it
// drives the worker along each dash's single-axis waypoints and, before committing a dash that
// enters a lethal train band, GATES on the deterministic schedule — predicting the worker's own
// trajectory (at the real sprint-then-walk speed the sim will produce) and refusing to start
// until no train overlaps that trajectory across a small safety window. This is the "competent
// play" the beatability invariant (specs/levels.md) is measured against.
//
// Two degenerate variants pin that the campaign's pressures actually bite:
//   • `reckless` — the SAME routes with gating OFF: it charges every crossing without reading
//     the schedule, so the trains catch it (timing pressure).
//   • `greedy` — gates, but OVERLOADS at each depot (hauls to the weight cap), so it crawls and
//     loses sprint on the heavy classes, dragging its crossings out and its margins down
//     (carry-weight pressure).
//
// All three are deterministic: identical decisions from an identical state, no RNG, no clock.

import {
  SPRINT_MAX,
  SPRINT_MULT,
  TILE,
  TRAIN_HALF_BAND,
  V0,
  VIEW_W,
  VIEW_Y,
  W_MAX,
  WORKER_FOOT_H,
  WORKER_FOOT_W,
} from "../src/constants";
import type { TrackDef, TrainKind } from "../src/types";
import { currentLoad, loadFraction, speedMultiplier, sprintLocked } from "../src/sim/step";
import type { SimInput, SimState, Vec2 } from "../src/sim/world";
import { nominalTrainLength, tileCenter, trainSpeed } from "../src/sim/world";
import { ROUTES, type RouteAction } from "./routes";
import type { Controller } from "./harness";

// ─── Gate geometry ──────────────────────────────────────────────────────────────────────

/** Vertical reach (px) from a lane center at which the worker's foot box touches the lethal
 *  band, plus a safety pad. A tile one row away (40px) stays clear. */
const BAND = TRAIN_HALF_BAND + WORKER_FOOT_H / 2 + 2; // 30
/** Horizontal margin (px) kept clear of a car body: half the foot box plus a buffer. */
const XM = WORKER_FOOT_W / 2 + 9; // 21
/** Path sampling step (px) for the trajectory predictor. */
const SAMPLE_PX = 6;
/** Time offsets (s) each danger sample is checked at, so small timing drift never kills. */
const TIME_OFFSETS = [-0.13, -0.06, 0, 0.08, 0.16, 0.26, 0.38];
/** How close (px) to a waypoint counts as reached (≈ one sprint frame). */
const REACH = 4.5;
/** Dead-band (px) inside which an axis is considered aligned. */
const ALIGN = 2.5;
/** Give up on a stuck dash after this many gate-blocked steps (a data bug, surfaced as failure). */
const MAX_WAIT_STEPS = 60 * 30;

// ─── A horizontal train body span predicted at some absolute time ────────────────────────

interface Span {
  line: number;
  x0: number;
  x1: number;
}

function neutral(): SimInput {
  return { up: false, down: false, left: false, right: false, sprint: false, pickup: false, drop: false, interact: false };
}

/** The line a track's NEXT (future) train will run on, honoring a thrown lever's siding. */
function effLine(state: SimState, track: TrackDef): number {
  if (track.leverId && track.sidingLine !== undefined && state.levers[track.leverId]?.thrown) {
    return track.sidingLine;
  }
  return track.line;
}

/** Lane center y (px) of a horizontal line. */
function laneY(line: number): number {
  return VIEW_Y + line * TILE + TILE / 2;
}

/** Body x-span of a horizontal train given its head (px travelled from entry) and direction. */
function bodySpan(dir: string, head: number, length: number, line: number): Span {
  if (dir === "east") return { line, x0: head - length, x1: head };
  return { line, x0: VIEW_W - head, x1: VIEW_W - head + length }; // west
}

/** The derived last train's spawn time, replicating core `ensureLastTrainTime`. */
function lastTrainSpawnTime(state: SimState): number | undefined {
  if (state.lastTrainSpawnTime !== undefined) return state.lastTrainSpawnTime;
  const lt = state.level.lastTrain;
  if (!lt) return undefined;
  const v = trainSpeed(lt.kind);
  const P = lt.orientation === "horizontal" ? VIEW_W : 640;
  const L = lt.consist.reduce((s, piece) => {
    const unit = lt.kind === "freight" ? 80 : lt.kind === "commuter" ? 60 : 45;
    return s + (piece === "flat-top-half" ? unit / 2 : unit);
  }, 0);
  return Math.max(0, state.level.clock - (P + L) / v);
}

/**
 * Every horizontal train body span predicted at absolute time `absT`, from (a) live trains
 * advanced forward and (b) future scheduled arrivals on each track's effective line. Conservative
 * for gating: the last train and any diverted service are all treated as lethal bodies.
 */
function spansAt(state: SimState, absT: number): Span[] {
  const spans: Span[] = [];
  const tau = absT - state.time;

  for (const t of state.trains) {
    if (t.orientation !== "horizontal") continue;
    const head = t.headPos + t.speed * tau;
    if (head < 0 || head > VIEW_W + t.length + TILE) continue;
    spans.push(bodySpan(t.dir, head, t.length, t.line));
  }

  const lts = lastTrainSpawnTime(state);
  for (const track of state.level.tracks) {
    if (track.orientation !== "horizontal") continue;
    const line = effLine(state, track);
    const len = nominalTrainLength(track.kind as TrainKind);
    const spd = trainSpeed(track.kind as TrainKind);
    const isLastLane =
      state.level.lastTrain &&
      track.orientation === state.level.lastTrain.orientation &&
      track.line === state.level.lastTrain.line &&
      track.dir === state.level.lastTrain.dir;
    let n = state.trackSerial[track.id]; // first un-spawned serial (all earlier ones are live/retired)
    for (let k = 0; k < 80; k++, n++) {
      const entry = track.phase + n * track.period;
      if (entry > absT) break;
      if (isLastLane && lts !== undefined && entry >= lts) continue; // suppressed before the last train
      const head = (absT - entry) * spd;
      if (head > VIEW_W + len + TILE) continue;
      spans.push(bodySpan(track.dir, head, len, line));
    }
  }
  return spans;
}

/** Whether a point (x,y) is inside any predicted lethal span at `absT` (with margins). */
function pointLethal(spans: Span[], x: number, y: number): boolean {
  for (const s of spans) {
    if (Math.abs(laneY(s.line) - y) > BAND) continue;
    if (x >= s.x0 - XM && x <= s.x1 + XM) return true;
  }
  return false;
}

/** Whether a point's y is inside SOME live/effective lane band (i.e. the worker is exposed there). */
function inAnyBand(state: SimState, y: number): boolean {
  for (const t of state.trains) {
    if (t.orientation === "horizontal" && Math.abs(laneY(t.line) - y) <= BAND) return true;
  }
  for (const track of state.level.tracks) {
    if (track.orientation === "horizontal" && Math.abs(laneY(effLine(state, track)) - y) <= BAND) return true;
  }
  return false;
}

// ─── Trajectory samples of a dash (in the worker's own frame of motion) ──────────────────

interface Sample {
  x: number;
  y: number;
  dist: number; // cumulative path distance (px) from the dash start
  exposed: boolean; // the worker is inside some lane band here
}

/** Sample the polyline current→…→waypoints at SAMPLE_PX, flagging band exposure. */
function sampleDash(state: SimState, start: Vec2, pts: Vec2[]): Sample[] {
  const out: Sample[] = [];
  let prev = start;
  let acc = 0;
  const push = (x: number, y: number, d: number) => out.push({ x, y, dist: d, exposed: inAnyBand(state, y) });
  push(prev.x, prev.y, 0);
  for (const p of pts) {
    const dx = p.x - prev.x;
    const dy = p.y - prev.y;
    const len = Math.hypot(dx, dy);
    const steps = Math.max(1, Math.ceil(len / SAMPLE_PX));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      push(prev.x + dx * t, prev.y + dy * t, acc + len * t);
    }
    acc += len;
    prev = p;
  }
  return out;
}

/**
 * Path-time (s) to reach cumulative distance `d`, modelling the sim's sprint-then-walk speed:
 * the worker sprints (covering `sprintCharge · sprintSpeed` px) then drops to the walk speed —
 * exactly what the driven dash produces, so the predicted crossing times are accurate at any
 * dash length. If sprint is locked out by load, the whole path is walked.
 */
function timeAt(d: number, walk: number, sprint: number, sprintCharge: number, canSprint: boolean): number {
  if (!canSprint) return d / walk;
  const sprintDist = sprintCharge * sprint;
  if (d <= sprintDist) return d / sprint;
  return sprintCharge + (d - sprintDist) / walk;
}

// ─── The route controller ─────────────────────────────────────────────────────────────────

interface Options {
  gate: boolean; // read the schedule before crossing (false = reckless)
  overloadTo?: number; // if set, grab up to this many capacity-units at each depot (greedy)
}

class RouteController implements Controller {
  readonly name: string;
  private readonly actions: RouteAction[];
  private readonly opt: Options;
  private ai = 0; // action index
  private committed = false; // current dash is cleared and being driven
  private sprintDead = false; // latch: once the bar empties mid-dash, stop requesting sprint
  private wp = 0; // waypoint index within the current dash
  private waitSteps = 0;
  private grabStart = 0; // carried count at grab start
  private leverCooldown = 0;

  constructor(levelId: number, name: string, opt: Options) {
    this.name = name;
    this.actions = ROUTES[levelId]?.actions ?? [];
    this.opt = opt;
  }

  next(state: SimState): SimInput {
    const a = this.actions[this.ai];
    if (!a) return neutral(); // route complete — idle safely (park)

    switch (a.k) {
      case "dash":
        return this.doDash(state, a.to.map((c) => tileCenter(c)));
      case "grab":
        return this.doGrab(state, a.count ?? 1);
      case "lever":
        return this.doLever(state, a.id, a.thrown ?? true);
      case "idle":
        return this.doIdle(a.sec);
    }
  }

  private advance(): void {
    this.ai++;
    this.committed = false;
    this.wp = 0;
    this.waitSteps = 0;
    this.grabStart = 0;
    this.lastGot = 0;
    this.gainStep = 0;
    this.leverCooldown = 0;
    this.idleStart = -1;
  }

  // ── dash: gate then drive the waypoints ──────────────────────────────────────────────
  private doDash(state: SimState, pts: Vec2[]): SimInput {
    const w = state.worker;
    if (!this.committed) {
      if (this.opt.gate && !this.clear(state, pts)) {
        this.waitSteps++;
        if (this.waitSteps > MAX_WAIT_STEPS) this.advance(); // stuck — let the level fail visibly
        return neutral(); // hold on the safe tile, recharging sprint
      }
      this.committed = true;
      this.sprintDead = false;
      this.wp = 0;
    }
    // Once the sprint bar empties, latch it OFF for the rest of the dash. Otherwise the worker
    // would keep requesting sprint and micro-sprint every other frame (the bar recharges while
    // walking and is spent immediately), running ~17% faster than the clean walk the gate's
    // predictor modelled — arriving in the band earlier than predicted, into a train.
    if (w.sprintCharge <= 0.03) this.sprintDead = true;
    // Drive toward the current waypoint (single axis per leg).
    const target = pts[this.wp];
    const dx = target.x - w.pos.x;
    const dy = target.y - w.pos.y;
    if (Math.abs(dx) <= REACH && Math.abs(dy) <= REACH) {
      this.wp++;
      if (this.wp >= pts.length) {
        this.advance();
        return this.next(state);
      }
      return this.doDash(state, pts);
    }
    const input = neutral();
    input.right = dx > ALIGN;
    input.left = dx < -ALIGN;
    input.down = dy > ALIGN;
    input.up = dy < -ALIGN;
    input.sprint = !this.sprintDead; // request until the bar latches off (see above)
    return input;
  }

  /** Whether the whole dash is safe to start now: no train overlaps the predicted trajectory. */
  private clear(state: SimState, pts: Vec2[]): boolean {
    const w = state.worker;
    const samples = sampleDash(state, w.pos, pts);
    const frac = loadFraction(currentLoad(w));
    const mult = speedMultiplier(frac);
    const walk = V0 * mult;
    const sprint = walk * SPRINT_MULT;
    const canSprint = !sprintLocked(frac);
    for (const s of samples) {
      if (!s.exposed) continue;
      const t = timeAt(s.dist, walk, sprint, w.sprintCharge, canSprint);
      for (const off of TIME_OFFSETS) {
        const spans = spansAt(state, state.time + t + off);
        if (pointLethal(spans, s.x, s.y)) return false;
      }
    }
    return true;
  }

  // ── grab: pick up `count` at the current spot (greedy overloads toward the cap instead) ──
  private gainStep = 0; // last step at which the carried count grew
  private lastGot = 0;
  private doGrab(state: SimState, count: number): SimInput {
    const w = state.worker;
    if (this.waitSteps === 0) {
      this.grabStart = w.carried.length;
      this.gainStep = 0;
    }
    if (w.carried.length > this.grabStart + this.lastGot) {
      this.lastGot = w.carried.length - this.grabStart;
      this.gainStep = this.waitSteps;
    }
    this.waitSteps++;
    const got = this.lastGot;
    // Want another package? Greedy hauls toward the weight cap; competent stops at `count`. Either
    // way, give up once a refill window (~2s) passes with no gain (a single-package tile is empty).
    const noGainWindow = this.waitSteps - this.gainStep >= 60 * 2;
    const wantMore =
      got >= 1 &&
      !noGainWindow &&
      (this.opt.overloadTo !== undefined ? currentLoad(w) < this.opt.overloadTo : got < count);
    if (got >= 1 && !wantMore) {
      this.lastGot = 0;
      this.advance();
      return neutral();
    }
    if (got < 1 && this.waitSteps > 60 * 3) {
      this.lastGot = 0;
      this.advance(); // nothing to grab here — surfaces a mis-placed route
      return neutral();
    }
    return { ...neutral(), pickup: true };
  }

  // ── lever: toggle a junction to the desired setting (one clean pulse) ─────────────────
  private doLever(state: SimState, id: string, desired: boolean): SimInput {
    if (state.levers[id]?.thrown === desired) {
      this.advance();
      return neutral();
    }
    if (this.leverCooldown > 0) {
      this.leverCooldown--;
      return neutral();
    }
    this.leverCooldown = 2;
    return { ...neutral(), interact: true };
  }

  // ── idle: stand safely for a fixed time ──────────────────────────────────────────────
  private idleStart = -1;
  private doIdle(sec: number): SimInput {
    if (this.idleStart < 0) this.idleStart = 0;
    this.idleStart++;
    if (this.idleStart / 60 >= sec) {
      this.advance();
    }
    return neutral();
  }
}

// ─── Factories ────────────────────────────────────────────────────────────────────────────

export function competent(levelId: number): Controller {
  return new RouteController(levelId, "competent", { gate: true });
}
export function reckless(levelId: number): Controller {
  return new RouteController(levelId, "reckless", { gate: false });
}
export function greedy(levelId: number): Controller {
  // Overload toward the cap so the heavy classes lock sprint and crawl the crossings.
  return new RouteController(levelId, "greedy", { gate: true, overloadTo: W_MAX });
}

/** For the run report: name → factory. */
export const CONTROLLERS: Array<{ name: string; make: (levelId: number) => Controller }> = [
  { name: "competent", make: competent },
  { name: "reckless", make: reckless },
  { name: "greedy", make: greedy },
];
