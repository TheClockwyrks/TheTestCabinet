// Locomotivation — the pure CORE STEPPER (specs/controls.md).
//
// `stepSim(state, input, dt)` advances the whole simulation one fixed step,
// deterministically and free of rendering/wall-clock. It is the single entry point the
// game loop AND the Balance-phase headless harness call. Every subsystem pass here is
// deterministic: no RNG, no Date/performance, no DOM. Cause precedes effect — dispensers
// refill, the worker moves, trains advance and schedule, cargo interactions resolve,
// lethal collisions are checked, then the clock and win/fail phase update.

import {
  DISPENSER_REFILL,
  INTERACT_REACH,
  NEAR_MISS_MARGIN,
  RESPAWN_DELAY,
  SCORE_LAST_TRAIN_BONUS,
  SCORE_LIVES_BONUS,
  SCORE_NEAR_MISS,
  SCORE_OPTIONAL_DELIVERY,
  SCORE_REQUIRED_DELIVERY,
  SCORE_TIME_BONUS_PER_SEC,
  SPRINT_LOCK_FRACTION,
  SPRINT_MAX,
  SPRINT_MULT,
  SPRINT_RECHARGE,
  TILE,
  TRAIN_HALF_BAND,
  V0,
  VIEW_W,
  VIEW_H,
  W_MAX,
  WEIGHT_FULL_UNTIL,
  WEIGHT_M_AT_CAP,
  WEIGHT_M_AT_FULL,
  WEIGHT_M_AT_SLOW,
  WEIGHT_SLOW_UNTIL,
  WORKER_FOOT_H,
  WORKER_FOOT_W,
} from "../constants";
import type { FreightColor, TrackDef } from "../types";
import type { AABB, Facing, PackageInstance, SimInput, SimState, TrainInstance, Vec2, WorkerState } from "./world";
import {
  aabbOverlap,
  consistLength,
  carPieceLength,
  isWalkable,
  laneCenter,
  nominalTrainLength,
  tileAtPixel,
  tileCenter,
  tileKindAt,
  trainBody,
  trainLeadingEdge,
  trainSpeed,
  travelSign,
  weightOf,
  workerBox,
} from "./world";

const FOOT_HALF_W = WORKER_FOOT_W / 2;
const FOOT_HALF_H = WORKER_FOOT_H / 2;

// ─── Carry-weight & sprint math (specs/character.md — fully implemented) ─────────────

/** Total carried weight in capacity units. */
export function currentLoad(worker: WorkerState): number {
  return worker.carried.reduce((sum, p) => sum + weightOf(p.weightClass), 0);
}

/** Load as a fraction of capacity, w = load / W_MAX (cap enforced on pickup). */
export function loadFraction(load: number): number {
  return load / W_MAX;
}

/**
 * The base speed multiplier m(w) (specs/character.md):
 *   w ≤ 0.50            → 1.00
 *   0.50 < w ≤ 0.80     → linear 1.00 → 0.70
 *   0.80 < w ≤ 1.00     → linear 0.70 → 0.50
 */
export function speedMultiplier(w: number): number {
  if (w <= WEIGHT_FULL_UNTIL) return WEIGHT_M_AT_FULL;
  if (w <= WEIGHT_SLOW_UNTIL) {
    const t = (w - WEIGHT_FULL_UNTIL) / (WEIGHT_SLOW_UNTIL - WEIGHT_FULL_UNTIL);
    return WEIGHT_M_AT_FULL + t * (WEIGHT_M_AT_SLOW - WEIGHT_M_AT_FULL);
  }
  const t = Math.min(1, (w - WEIGHT_SLOW_UNTIL) / (1 - WEIGHT_SLOW_UNTIL));
  return WEIGHT_M_AT_SLOW + t * (WEIGHT_M_AT_CAP - WEIGHT_M_AT_SLOW);
}

/** Sprint is locked out entirely above the load threshold (specs/character.md). */
export function sprintLocked(w: number): boolean {
  return w > SPRINT_LOCK_FRACTION;
}

/** Whether the worker may sprint right now (not locked by load, and has charge). */
export function sprintAvailable(w: number, sprintCharge: number): boolean {
  return !sprintLocked(w) && sprintCharge > 0;
}

/** The worker's current walk speed (px/s), given weight and whether it is sprinting. */
export function currentSpeed(worker: WorkerState): number {
  const w = loadFraction(currentLoad(worker));
  const base = V0 * speedMultiplier(w);
  return worker.sprinting ? base * SPRINT_MULT : base;
}

// ─── The step ────────────────────────────────────────────────────────────────────────

/**
 * Advance the simulation by `dt` seconds. Ordered so cause precedes effect. Terminal
 * phases ("won"/"lost") freeze. Trains and dispensers advance in every live phase so the
 * yard stays alive during the death beat and the last-train ride; worker control, cargo,
 * and lethal collisions apply only while actually "playing".
 */
export function stepSim(state: SimState, input: SimInput, dt: number): void {
  state.events = [];
  if (state.phase === "won" || state.phase === "lost") return;

  state.time += dt;

  stepDispensers(state, dt);
  stepTrains(state, dt);

  if (state.phase === "playing") {
    stepWorkerMovement(state, input, dt);
    resolveCargo(state, input);
    resolveLethalCollisions(state);
  } else if (state.phase === "boarding") {
    rideBoardedTrain(state);
  }

  stepClockAndPhase(state, dt);
}

// ─── Dispensers (specs/cargo.md) ─────────────────────────────────────────────────────

function stepDispensers(state: SimState, dt: number): void {
  for (const d of state.level.dispensers) {
    const rt = state.dispensers[d.id];
    if (rt.ready) continue;
    rt.refillTimer -= dt;
    if (rt.refillTimer <= 0) {
      rt.refillTimer = 0;
      rt.ready = true;
    }
  }
}

// ─── Worker movement (specs/character.md) ────────────────────────────────────────────

function stepWorkerMovement(state: SimState, input: SimInput, dt: number): void {
  const w = state.worker;
  if (w.dropTimer > 0) w.dropTimer = Math.max(0, w.dropTimer - dt);

  // Cardinal intent; opposite keys cancel. Diagonal keeps the same magnitude.
  let ix = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  let iy = (input.down ? 1 : 0) - (input.up ? 1 : 0);
  const moving = ix !== 0 || iy !== 0;
  if (ix !== 0 && iy !== 0) {
    const inv = 1 / Math.SQRT2;
    ix *= inv;
    iy *= inv;
  }

  // Facing follows the pressed direction (horizontal takes precedence for a clear read).
  w.facing = pickFacing(input, w.facing);

  // Sprint: only while moving, unlocked by load, and with charge. Drain/recharge the bar.
  const load = currentLoad(w);
  const frac = loadFraction(load);
  const wantSprint = input.sprint && moving && sprintAvailable(frac, w.sprintCharge);
  w.sprinting = wantSprint;
  if (wantSprint) {
    w.sprintCharge = Math.max(0, w.sprintCharge - dt);
  } else if (w.sprintCharge < SPRINT_MAX) {
    w.sprintCharge = Math.min(SPRINT_MAX, w.sprintCharge + dt * (SPRINT_MAX / SPRINT_RECHARGE));
  }

  const speed = currentSpeed(w);
  const vx = ix * speed;
  const vy = iy * speed;

  // Move axis-independently so the worker slides along blocked walls/gaps.
  if (vx !== 0) {
    const nx = w.pos.x + vx * dt;
    if (!blocked(state, nx, w.pos.y)) w.pos.x = nx;
  }
  if (vy !== 0) {
    const ny = w.pos.y + vy * dt;
    if (!blocked(state, w.pos.x, ny)) w.pos.y = ny;
  }

  w.moving = moving;

  // Animation state (Squish/Drop are set by their own events; here we resolve the rest).
  if (w.dropTimer > 0) w.anim = "drop";
  else if (w.carried.length > 0) w.anim = "carry";
  else if (moving && w.sprinting) w.anim = "sprint";
  else if (moving) w.anim = "walk";
  else w.anim = "idle";

  // Advance the animation clock. Idle always breathes; motion cycles advance while moving.
  if (w.anim === "idle" || moving || w.dropTimer > 0) w.animTime += dt;

  // Footstep cadence — emit a step (audio + dust) at a distance interval while moving.
  if (moving) {
    w.footstepPhase += speed * dt;
    const stride = w.sprinting ? 26 : 34;
    if (w.footstepPhase >= stride) {
      w.footstepPhase -= stride;
      state.events.push({ type: "footstep", pos: { ...w.pos } });
    }
  } else {
    w.footstepPhase = 0;
  }
}

/** Facing from the held keys, keeping the previous facing when nothing is pressed. */
function pickFacing(input: SimInput, prev: Facing): Facing {
  if (input.left && !input.right) return "left";
  if (input.right && !input.left) return "right";
  if (input.up && !input.down) return "up";
  if (input.down && !input.up) return "down";
  return prev;
}

/** Whether the worker footprint at (x,y) would overlap any wall/gap/out-of-bounds tile. */
function blocked(state: SimState, x: number, y: number): boolean {
  const box = workerBox({ x, y }, FOOT_HALF_W, FOOT_HALF_H);
  const c0 = tileAtPixel({ x: box.x0, y: box.y0 });
  const c1 = tileAtPixel({ x: box.x1, y: box.y1 });
  for (let row = c0.row; row <= c1.row; row++) {
    for (let col = c0.col; col <= c1.col; col++) {
      const kind = tileKindAt(state, col, row);
      if (kind === "wall" || kind === "gap") return true;
    }
  }
  return false;
}

// ─── Trains: scheduling + advance + the derived last train (specs/trains.md) ──────────

function stepTrains(state: SimState, dt: number): void {
  ensureLastTrainTime(state);

  // Schedule any due regular trains, capturing lever routing at the moment of spawn.
  for (const track of state.level.tracks) {
    let serial = state.trackSerial[track.id];
    while (track.phase + serial * track.period <= state.time) {
      spawnRegularTrain(state, track, serial);
      serial++;
      state.trackSerial[track.id] = serial;
    }
  }

  // Spawn the derived last train exactly when due.
  const lt = state.level.lastTrain;
  if (lt && !state.lastTrainSpawned && state.lastTrainSpawnTime !== undefined && state.time >= state.lastTrainSpawnTime) {
    spawnLastTrain(state);
  }

  // Advance every live train at its constant speed; retire ones fully off the far edge.
  for (const t of state.trains) t.headPos += t.speed * dt;
  state.trains = state.trains.filter((t) => t.headPos <= viewLen(t) + t.length + TILE);
}

/** The travel-axis length of the view a train crosses (width for horizontal lanes). */
function viewLen(t: TrainInstance): number {
  return t.orientation === "horizontal" ? VIEW_W : VIEW_H;
}

function ensureLastTrainTime(state: SimState): void {
  const lt = state.level.lastTrain;
  if (!lt || state.lastTrainSpawnTime !== undefined) return;
  const v = trainSpeed(lt.kind);
  const L = consistLength(lt.kind, lt.consist);
  const P = lt.orientation === "horizontal" ? VIEW_W : VIEW_H;
  // t_spawn = T_shift − (P + L) / v, so its tail clears the map exactly at clock 0.
  state.lastTrainSpawnTime = Math.max(0, state.level.clock - (P + L) / v);
}

function spawnRegularTrain(state: SimState, track: TrackDef, serial: number): void {
  // Suppress regular service on the last-train lane inside its final window, so the last
  // train is that lane's final service (specs/levels.md, specs/trains.md).
  const lt = state.level.lastTrain;
  const entryTime = track.phase + serial * track.period;
  if (lt && isLastTrainLane(track, lt) && state.lastTrainSpawnTime !== undefined && entryTime >= state.lastTrainSpawnTime) {
    return;
  }

  const line = liveLine(state, track);
  state.trains.push({
    trackId: track.id,
    kind: track.kind,
    orientation: track.orientation,
    line,
    dir: track.dir,
    headPos: 0,
    length: nominalTrainLength(track.kind),
    speed: trainSpeed(track.kind),
    serial,
  });
}

function spawnLastTrain(state: SimState): void {
  const lt = state.level.lastTrain!;
  // The last train runs on the base line of its lane (levers do not divert it).
  state.trains.push({
    trackId: "LAST",
    kind: lt.kind,
    orientation: lt.orientation,
    line: lt.line,
    dir: lt.dir,
    headPos: 0,
    length: consistLength(lt.kind, lt.consist),
    speed: trainSpeed(lt.kind),
    serial: 0,
    isLast: true,
    consist: [...lt.consist],
  });
  state.lastTrainSpawned = true;
  const edge = trainLeadingEdge(state.trains[state.trains.length - 1], VIEW_W, VIEW_H);
  const cy = laneCenter(lt.orientation, lt.line);
  state.events.push({
    type: "last-train",
    pos: lt.orientation === "horizontal" ? { x: edge, y: cy } : { x: cy, y: edge },
  });
}

/** Whether `track` is the lane the level's last train departs on. */
function isLastTrainLane(track: TrackDef, lt: NonNullable<SimState["level"]["lastTrain"]>): boolean {
  return track.orientation === lt.orientation && track.line === lt.line && track.dir === lt.dir;
}

/** The live line a track's next train uses, honoring a thrown lever's siding diversion. */
function liveLine(state: SimState, track: TrackDef): number {
  if (track.leverId && track.sidingLine !== undefined) {
    const lever = state.levers[track.leverId];
    if (lever?.thrown) return track.sidingLine;
  }
  return track.line;
}

// ─── Cargo: pickup / interact / drop / auto-deliver (specs/cargo.md) ──────────────────

function resolveCargo(state: SimState, input: SimInput): void {
  const w = state.worker;

  if (input.interact) tryLever(state);
  if (input.pickup) tryPickup(state);
  if (input.drop) tryDrop(state);

  // Auto-deliver: entering a color-matched zone delivers every carried package of its color.
  const foot = workerBox(w.pos, FOOT_HALF_W, FOOT_HALF_H);
  for (const zone of state.level.dropZones) {
    if (!aabbOverlap(foot, tileBox(zone.at.col, zone.at.row))) continue;
    deliverColor(state, zone.color, tileCenter(zone.at));
  }
}

/** Toggle an adjacent lever (specs/trains.md). */
function tryLever(state: SimState): void {
  const w = state.worker;
  for (const lv of state.level.levers) {
    if (withinReach(w.pos, lv.at.col, lv.at.row)) {
      const rt = state.levers[lv.id];
      rt.thrown = !rt.thrown;
      state.events.push({ type: "lever", leverId: lv.id, pos: tileCenter(lv.at) });
      return;
    }
  }
}

/** Pick up the nearest reachable package or dispenser output, under the weight cap. */
function tryPickup(state: SimState): void {
  const w = state.worker;
  const load = currentLoad(w);

  // Prefer a loose ground package (unique/optional/dropped) in reach.
  let bestIdx = -1;
  let bestDist = Infinity;
  for (let i = 0; i < state.ground.length; i++) {
    const gp = state.ground[i];
    if (!withinReachPx(w.pos, gp.pos)) continue;
    const d = dist2(w.pos, gp.pos);
    if (d < bestDist) {
      bestDist = d;
      bestIdx = i;
    }
  }
  if (bestIdx >= 0) {
    const gp = state.ground[bestIdx];
    if (load + weightOf(gp.pkg.weightClass) > W_MAX) {
      state.events.push({ type: "denied", pos: { ...w.pos } });
      return;
    }
    w.carried.push(gp.pkg);
    state.ground.splice(bestIdx, 1);
    state.events.push({ type: "pickup", pos: { ...gp.pos } });
    return;
  }

  // Otherwise take a ready dispenser's package in reach.
  for (const d of state.level.dispensers) {
    if (!withinReach(w.pos, d.at.col, d.at.row)) continue;
    const rt = state.dispensers[d.id];
    if (!rt.ready) continue;
    const cls = d.weight;
    if (load + weightOf(cls) > W_MAX) {
      state.events.push({ type: "denied", pos: { ...w.pos } });
      return;
    }
    const pkg: PackageInstance = {
      id: `${d.id}#${state.time.toFixed(3)}`,
      color: d.color,
      weightClass: cls,
      archetype: "dispenser",
      originId: d.id,
    };
    w.carried.push(pkg);
    rt.ready = false;
    rt.refillTimer = DISPENSER_REFILL;
    state.events.push({ type: "pickup", pos: tileCenter(d.at) });
    return;
  }
}

/** Drop the most-recently carried package at the worker's tile or nearest free tile. */
function tryDrop(state: SimState): void {
  const w = state.worker;
  const pkg = w.carried.pop();
  if (!pkg) return;
  const spot = dropSpot(state);
  state.ground.push({ pkg, at: spot, pos: tileCenter(spot) });
  w.dropTimer = 0.35;
  state.events.push({ type: "drop", pos: tileCenter(spot) });
}

/** The tile a dropped package lands on: the worker's tile, else the nearest free walkable one. */
function dropSpot(state: SimState): { col: number; row: number } {
  const w = state.worker;
  const here = tileAtPixel(w.pos);
  if (tileFree(state, here.col, here.row)) return here;
  // Search outward in a small ring for a free walkable tile.
  for (let r = 1; r <= 3; r++) {
    for (let dr = -r; dr <= r; dr++) {
      for (let dc = -r; dc <= r; dc++) {
        if (Math.max(Math.abs(dr), Math.abs(dc)) !== r) continue;
        const col = here.col + dc;
        const row = here.row + dr;
        if (tileFree(state, col, row)) return { col, row };
      }
    }
  }
  return here; // fallback: stack on our own tile
}

/** A tile is a valid drop spot if walkable and not already holding a ground package. */
function tileFree(state: SimState, col: number, row: number): boolean {
  const kind = tileKindAt(state, col, row);
  if (!isWalkable(kind)) return false;
  return !state.ground.some((g) => g.at.col === col && g.at.row === row);
}

/** Deliver every carried package matching `color` into a zone of that color. */
function deliverColor(state: SimState, color: FreightColor, pos: Vec2): void {
  const w = state.worker;
  const keep: PackageInstance[] = [];
  let deliveredAny = false;
  for (const pkg of w.carried) {
    if (pkg.color !== color) {
      keep.push(pkg);
      continue;
    }
    deliveredAny = true;
    if (pkg.archetype === "unique") {
      state.uniquesDelivered[pkg.originId] = true;
      state.delivered[color] += 1;
      state.scoreParts.required += SCORE_REQUIRED_DELIVERY;
      state.score += SCORE_REQUIRED_DELIVERY;
    } else if (pkg.archetype === "dispenser") {
      state.delivered[color] += 1;
      state.scoreParts.required += SCORE_REQUIRED_DELIVERY;
      state.score += SCORE_REQUIRED_DELIVERY;
    } else {
      state.optionalsDelivered += 1;
      state.scoreParts.optional += SCORE_OPTIONAL_DELIVERY;
      state.score += SCORE_OPTIONAL_DELIVERY;
    }
  }
  if (deliveredAny) {
    w.carried = keep;
    state.events.push({ type: "deliver", color, pos });
  }
}

// ─── Lethal collisions, cargo destruction, near-miss, boarding (specs/trains.md) ──────

function resolveLethalCollisions(state: SimState): void {
  const w = state.worker;
  const foot = workerBox(w.pos, FOOT_HALF_W, FOOT_HALF_H);

  for (const t of state.trains) {
    const body = trainBody(t, VIEW_W, VIEW_H, TRAIN_HALF_BAND);

    // Cargo resting on a track/bridge tile under this train is smashed (without slowing it).
    destroyCargoUnder(state, body);

    if (t.isLast) {
      // Per-car resolution: rideable flat-tops board (if quota met), sealed cars are lethal.
      const hit = lastTrainCarHit(t, foot);
      if (hit === "ride" && state.quotaMet && !state.boardedTrain) {
        boardTrain(state, t);
        return;
      }
      if (hit === "lethal") {
        killWorker(state);
        return;
      }
      if (hit === "none") maybeNearMiss(state, t, body, foot);
      continue;
    }

    if (aabbOverlap(foot, body)) {
      killWorker(state);
      return;
    }
    maybeNearMiss(state, t, body, foot);
  }
}

/** Destroy ground cargo sitting on a track/bridge tile that this train body overlaps. */
function destroyCargoUnder(state: SimState, body: AABB): void {
  const survivors = [];
  for (const gp of state.ground) {
    const kind = tileKindAt(state, gp.at.col, gp.at.row);
    const onRail = kind === "track" || kind === "bridge";
    const box = { x0: gp.pos.x - 12, y0: gp.pos.y - 12, x1: gp.pos.x + 12, y1: gp.pos.y + 12 };
    if (onRail && aabbOverlap(box, body)) {
      state.events.push({ type: "cargo-destroyed", pos: { ...gp.pos } });
      if (gp.pkg.archetype === "unique") {
        state.uniquesLost[gp.pkg.originId] = true;
      }
      continue; // removed
    }
    survivors.push(gp);
  }
  state.ground = survivors;
}

/** Which kind of last-train car the worker's foot is over: rideable, lethal, or none. */
function lastTrainCarHit(t: TrainInstance, foot: AABB): "ride" | "lethal" | "none" {
  const cars = lastTrainCars(t);
  let result: "ride" | "lethal" | "none" = "none";
  for (const car of cars) {
    if (!aabbOverlap(foot, car.box)) continue;
    if (car.lethal) return "lethal"; // lethal wins outright
    result = "ride";
  }
  return result;
}

interface CarBox {
  box: AABB;
  lethal: boolean;
}

/** Lay the last train's consist out into per-car boxes from the leading edge backward. */
function lastTrainCars(t: TrainInstance): CarBox[] {
  const consist = t.consist ?? [];
  const cy = laneCenter(t.orientation, t.line);
  const sign = travelSign(t.dir); // +1 travelling forward along the axis
  const lead = trainLeadingEdge(t, VIEW_W, VIEW_H);
  const cars: CarBox[] = [];
  let edge = lead; // leading edge of the current car
  for (const piece of consist) {
    const len = carPieceLength(t.kind, piece);
    // The car spans from `edge` back against the travel direction by `len`.
    const a = edge;
    const b = edge - sign * len;
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    const lethal = piece === "engine" || piece === "boxcar";
    if (t.orientation === "horizontal") {
      cars.push({ box: { x0: lo, y0: cy - TRAIN_HALF_BAND, x1: hi, y1: cy + TRAIN_HALF_BAND }, lethal });
    } else {
      cars.push({ box: { x0: cy - TRAIN_HALF_BAND, y0: lo, x1: cy + TRAIN_HALF_BAND, y1: hi }, lethal });
    }
    edge = b;
  }
  return cars;
}

/** Attach the worker to a boarded last-train car and award the one-off bonus. */
function boardTrain(state: SimState, t: TrainInstance): void {
  const w = state.worker;
  state.boardedTrain = t;
  const lead = trainLeadingEdge(t, VIEW_W, VIEW_H);
  const cy = laneCenter(t.orientation, t.line);
  if (t.orientation === "horizontal") {
    state.boardOffset = { x: w.pos.x - lead, y: cy - 8 - w.pos.y };
  } else {
    state.boardOffset = { x: cy - w.pos.x, y: w.pos.y - lead };
  }
  state.scoreParts.lastTrain += SCORE_LAST_TRAIN_BONUS;
  state.score += SCORE_LAST_TRAIN_BONUS;
  state.phase = "boarding";
  state.events.push({ type: "board", pos: { ...w.pos } });
}

/** Move the worker with the boarded car each step while it rides off-screen. */
function rideBoardedTrain(state: SimState): void {
  const t = state.boardedTrain;
  if (!t) return;
  const w = state.worker;
  const lead = trainLeadingEdge(t, VIEW_W, VIEW_H);
  const cy = laneCenter(t.orientation, t.line);
  if (t.orientation === "horizontal") {
    w.pos.x = lead + state.boardOffset.x;
    w.pos.y = cy - 8;
  } else {
    w.pos.x = cy;
    w.pos.y = lead + state.boardOffset.y;
  }
}

/** Award a living-dangerously near-miss the first time this train brushes the worker. */
function maybeNearMiss(state: SimState, t: TrainInstance, body: AABB, foot: AABB): void {
  if (t.nearMissed) return;
  const gap = boxGap(foot, body);
  if (gap > 0 && gap <= NEAR_MISS_MARGIN) {
    t.nearMissed = true;
    state.nearMisses += 1;
    state.scoreParts.nearMiss += SCORE_NEAR_MISS;
    state.score += SCORE_NEAR_MISS;
    state.events.push({ type: "near-miss", pos: { ...state.worker.pos } });
  }
}

/** Closest edge gap between two non-overlapping AABBs (0 if they overlap). */
function boxGap(a: AABB, b: AABB): number {
  const dx = Math.max(0, Math.max(b.x0 - a.x1, a.x0 - b.x1));
  const dy = Math.max(0, Math.max(b.y0 - a.y1, a.y0 - b.y1));
  return Math.hypot(dx, dy);
}

/** Kill the worker: squish, destroy carried cargo, spend a life, begin the respawn beat. */
function killWorker(state: SimState): void {
  const w = state.worker;
  state.events.push({ type: "death", pos: { ...w.pos } });
  for (const pkg of w.carried) {
    state.events.push({ type: "cargo-destroyed", pos: { ...w.pos } });
    if (pkg.archetype === "unique") state.uniquesLost[pkg.originId] = true;
  }
  w.carried = [];
  w.sprinting = false;
  w.moving = false;
  w.anim = "squish";
  w.animTime = 0;
  state.lives -= 1;
  state.phase = "dying";
  state.respawnTimer = RESPAWN_DELAY;
}

// ─── Clock, respawn, and win/fail (specs/flow.md) ────────────────────────────────────

function stepClockAndPhase(state: SimState, dt: number): void {
  // Unique loss is an immediate fail regardless of clock or lives.
  if (anyUniqueLost(state)) {
    fail(state, "unique-lost");
    return;
  }

  if (state.phase === "playing" || state.phase === "boarding") {
    state.clock = Math.max(0, state.clock - dt);
  }

  // The respawn beat after a death.
  if (state.phase === "dying") {
    state.respawnTimer -= dt;
    if (state.respawnTimer <= 0) {
      if (state.lives <= 0) {
        fail(state, "out-of-lives");
        return;
      }
      respawn(state);
    }
    return;
  }

  // Quota tracking (once met, latch it and fire a confirm).
  if (!state.quotaMet && quotaSatisfied(state)) {
    state.quotaMet = true;
    state.events.push({ type: "quota-complete" });
    // With no last train, meeting the quota completes the shift immediately.
    if (!state.level.lastTrain) {
      win(state);
      return;
    }
  }

  // Boarding resolves to a win once the ridden train has cleared the map.
  if (state.phase === "boarding" && (state.boardedTrain === null || !state.trains.includes(state.boardedTrain))) {
    win(state);
    return;
  }

  // The clock running out ends the shift: win if the quota was met, else fail.
  if (state.clock <= 0 && (state.phase === "playing" || state.phase === "boarding")) {
    if (state.quotaMet) win(state);
    else fail(state, "out-of-time");
  }
}

function respawn(state: SimState): void {
  const w = state.worker;
  w.pos = tileCenter(state.level.spawn);
  w.facing = "down";
  w.anim = "idle";
  w.animTime = 0;
  w.sprinting = false;
  w.moving = false;
  w.dropTimer = 0;
  w.footstepPhase = 0;
  w.sprintCharge = SPRINT_MAX;
  state.respawnTimer = 0;
  state.phase = "playing";
}

function win(state: SimState): void {
  // Final score adds the time and lives bonuses at the moment of completion.
  const timeBonus = Math.round(state.clock) * SCORE_TIME_BONUS_PER_SEC;
  const livesBonus = Math.max(0, state.lives) * SCORE_LIVES_BONUS;
  state.scoreParts.time += timeBonus;
  state.scoreParts.lives += livesBonus;
  state.score += timeBonus + livesBonus;
  state.phase = "won";
}

function fail(state: SimState, reason: SimState["failReason"]): void {
  if (state.phase === "lost") return;
  state.phase = "lost";
  state.failReason = reason;
}

function anyUniqueLost(state: SimState): boolean {
  return Object.values(state.uniquesLost).some(Boolean);
}

/** Every unique delivered AND every color's required total met (specs/flow.md). */
export function quotaSatisfied(state: SimState): boolean {
  for (const u of state.level.uniques) {
    if (!state.uniquesDelivered[u.id]) return false;
  }
  for (const q of state.level.quota) {
    if (state.delivered[q.color] < q.required) return false;
  }
  return true;
}

// ─── Small helpers ────────────────────────────────────────────────────────────────────

/** The pixel box of a tile (col,row). */
function tileBox(col: number, row: number): AABB {
  const c = tileCenter({ col, row });
  return { x0: c.x - TILE / 2, y0: c.y - TILE / 2, x1: c.x + TILE / 2, y1: c.y + TILE / 2 };
}

/** Whether the worker is within interaction reach of a tile center. */
function withinReach(pos: Vec2, col: number, row: number): boolean {
  return withinReachPx(pos, tileCenter({ col, row }));
}

function withinReachPx(pos: Vec2, target: Vec2): boolean {
  return Math.abs(pos.x - target.x) <= INTERACT_REACH && Math.abs(pos.y - target.y) <= INTERACT_REACH;
}

function dist2(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}
