// Holdfast — the threat director, raider AI, ranged combat, and the downed/bleed system
// (DESIGN §4, §3.7-3.8, specs/combat.md, specs/mode-base.md). The analogue of valence's
// waves.ts, extended to the whole fight.
//
// The threat director schedules raids on an escalating, tightening curve biased toward the
// dark: it announces a raid a lead-time before it lands, spawns raiders at the walkable edge
// gaps, and sizes each wave by the colony's age and wealth. Raiders pathfind toward the
// settlers and turrets (never breaking the colony's walls in the base start — they hold
// outside a walled line), and shoot from the open. Shooting is resolved on the tick for
// settlers, turrets, and raiders alike: range + line-of-sight + cover + skill → a hit roll →
// damage, a tracer, muzzle/blood/impact effects, and the gunshot/hit cues. A settler dropped
// to zero is downed and bleeds out unless a tended in time. All of it is DOM-free.

import {
  BLEED,
  DAY_SECONDS,
  RAIDER_DMG,
  RAIDER_FIRE_RATE,
  RAIDER_HIT,
  RAIDER_RANGE,
  RAIDER_SPEED,
  RAID_ANNOUNCE_LEAD,
  RAID_BREAK_FRAC,
  RAID_FIRST_DELAY,
  RAID_NIGHT_BIAS,
  RAID_SPAWN_POINTS_MAX,
  SETTLER_BASE_HIT,
  SETTLER_DMG,
  SETTLER_FIRE_RATE,
  SETTLER_RANGE,
  STRUCTURE_WEALTH,
  TRACER_LIFE,
  TURRET_DMG,
  TURRET_FIRE_RATE,
  TURRET_HIT,
  TURRET_RANGE,
  WEALTH_CROPS,
  WEALTH_MEALS,
  WEALTH_PER_SETTLER,
  WEALTH_RES_WOOD_ORE,
  hitChance,
  isDaylight,
  phaseOf,
  raidInterval,
  raiderCount,
  raiderHp,
  threatPoints,
} from "./constants";
import { findPath, moveAlong, reachableAdjacent } from "./pathfind";
import { tileCenterX, tileCenterY, tileOfPixelX, tileOfPixelY } from "./world";
import type { Raider, Settler, Structure } from "./types";
import type { Game } from "./sim";

// The colony's rough wealth — settlers, structures, and stocks — that scales raid size.
export function computeWealth(game: Game): number {
  let w = WEALTH_PER_SETTLER * game.livingSettlers().length;
  for (const s of game.structures) if (s.built) w += STRUCTURE_WEALTH[s.kind];
  w += WEALTH_RES_WOOD_ORE * (game.stock.wood + game.stock.ore);
  w += WEALTH_CROPS * game.stock.crops;
  w += WEALTH_MEALS * game.stock.meals;
  return w;
}

type ThreatState = "idle" | "announced" | "active";

// A raid that can make no progress (a fully sealed colony with no firing slit — raiders never
// break the walls in the base start) still ends: after this many seconds of active fighting,
// the raiders give up and break for the edge, so the threat loop always closes and the colony
// gets its respite (specs/combat.md "a repelled raid ends"). ~1.3 days at 1×.
const RAID_TIMEOUT = 120;

export class Threat {
  state: ThreatState = "idle";
  raidsSoFar = 0;
  nextRaidAt: number; // days-since-start when the next raid lands (game.nowDays scale)
  countdown = 0; // seconds until the announced raid spawns (for the HUD banner)
  private spawnCount = 0;
  private killed = 0; // raiders this raid killed in combat (drives the break check)
  private broke = false;
  private elapsed = 0; // seconds the current raid has been active (drives the timeout)
  private readonly leadDays = RAID_ANNOUNCE_LEAD / DAY_SECONDS;

  constructor(game: Game) {
    this.nextRaidAt = this.applyNightBias(game, RAID_FIRST_DELAY);
  }

  // Nudge a landing time into the coming dusk/night when it would otherwise fall in daylight
  // (specs/time.md night bias) — a night raid catches a tired, half-asleep crew.
  private applyNightBias(game: Game, at: number): number {
    const frac = at - Math.floor(at);
    if (isDaylight(phaseOf(frac)) && game.rng.chance(RAID_NIGHT_BIAS)) {
      let biased = Math.floor(at) + 0.63; // early night
      if (biased < at) biased += 1;
      return biased;
    }
    return at;
  }

  update(game: Game, dt: number): void {
    const now = game.nowDays;
    if (this.state === "idle" && now >= this.nextRaidAt - this.leadDays) this.announce(game);
    if (this.state === "announced") {
      this.countdown = Math.max(0, (this.nextRaidAt - now) * DAY_SECONDS);
      game.raidCountdown = this.countdown;
      if (now >= this.nextRaidAt) this.spawnRaid(game);
    }
    if (this.state === "active") {
      this.elapsed += dt;
      this.stepRaiders(game, dt);
      const enoughDead = this.spawnCount > 0 && this.killed / this.spawnCount >= RAID_BREAK_FRAC;
      if (!this.broke && (enoughDead || this.elapsed >= RAID_TIMEOUT)) {
        for (const r of game.raiders) if (!r.dead) r.fleeing = true; // survivors break and run
        this.broke = true;
      }
      if (game.raiders.length === 0) this.endRaid(game); // all killed or fled off-map
    }
  }

  private announce(game: Game): void {
    this.state = "announced";
    game.raidIncoming = true;
    game.raidCountdown = RAID_ANNOUNCE_LEAD;
    game.pushCue("alarm");
  }

  // Spawn the wave at 1–2 edge gaps, sized by day + wealth (specs/combat.md escalation).
  spawnRaid(game: Game, forced?: number): void {
    const count = forced ?? raiderCount(threatPoints(game.day, computeWealth(game)));
    const points = this.chooseSpawns(game);
    const hp = raiderHp(game.day);
    for (let i = 0; i < count; i++) {
      const sp = points[i % points.length]!;
      game.raiders.push(this.makeRaider(game, sp.tx, sp.ty, hp));
    }
    this.spawnCount = count;
    this.killed = 0;
    this.broke = false;
    this.elapsed = 0;
    this.state = "active";
    game.raidActive = true;
    game.raidIncoming = false;
    game.raidCountdown = 0;
  }

  private chooseSpawns(game: Game): { tx: number; ty: number }[] {
    const all = [...game.world.spawns];
    // shuffle deterministically, then take 1–2 (RAID_SPAWN_POINTS_MAX)
    for (let i = all.length - 1; i > 0; i--) {
      const j = game.rng.int(i + 1);
      [all[i], all[j]] = [all[j]!, all[i]!];
    }
    const n = 1 + game.rng.int(RAID_SPAWN_POINTS_MAX); // 1 or 2
    return all.slice(0, Math.min(n, all.length));
  }

  private makeRaider(game: Game, tx: number, ty: number, hp: number): Raider {
    return {
      id: game.nextEntityId(),
      x: tileCenterX(tx),
      y: tileCenterY(ty),
      facing: 0,
      health: hp,
      maxHealth: hp,
      path: [],
      pathIdx: 0,
      targetId: null,
      fireCooldown: game.rng.range(0, 1 / RAIDER_FIRE_RATE),
      fleeing: false,
      animT: 0,
      dead: false,
    };
  }

  onRaiderKilled(): void {
    this.killed += 1;
  }

  private endRaid(game: Game): void {
    this.state = "idle";
    game.raidActive = false;
    game.raidIncoming = false;
    game.raidCountdown = 0;
    game.tracers.length = 0;
    this.raidsSoFar += 1;
    game.score.raidsRepelled += 1;
    game.onRaidRepelled();
    this.nextRaidAt = this.applyNightBias(game, game.nowDays + raidInterval(this.raidsSoFar));
  }

  // ---- Raider movement AI --------------------------------------------------------
  private stepRaiders(game: Game, dt: number): void {
    for (const r of game.raiders) {
      if (r.dead) continue;
      r.animT += dt;

      if (r.fleeing) {
        if (r.path.length === 0 || r.pathIdx >= r.path.length) this.pathToEdge(game, r);
        const arrived = moveAlong(r, RAIDER_SPEED, dt);
        if (arrived) {
          r.dead = true; // ran off the map — despawns without a kill for the colony
        }
        continue;
      }

      const target = this.acquireTarget(game, r);
      r.targetId = target ? target.id : null;
      const goal = this.goalTile(game, target);
      const rtx = tileOfPixelX(r.x);
      const rty = tileOfPixelY(r.y);

      // Hold and fire once a target is in range with a clear line; otherwise advance.
      let holding = false;
      if (target) {
        const dist = Math.hypot(target.x - r.x, target.y - r.y);
        const los = game.world.lineOfSight(rtx, rty, tileOfPixelX(target.x), tileOfPixelY(target.y));
        if (dist <= RAIDER_RANGE * 0.92 && los) holding = true;
      }
      if (holding) {
        r.path = [];
        r.pathIdx = 0;
        r.facing = target ? Math.atan2(target.y - r.y, target.x - r.x) : r.facing;
        continue;
      }
      if (goal && (r.path.length === 0 || r.pathIdx >= r.path.length)) {
        const path = reachableAdjacent(game.world, { tx: rtx, ty: rty }, goal, true);
        r.path = path ?? [];
        r.pathIdx = 0;
      }
      moveAlong(r, RAIDER_SPEED, dt);
    }
  }

  private acquireTarget(game: Game, r: Raider): { id: number; x: number; y: number } | null {
    let best: { id: number; x: number; y: number } | null = null;
    let bestD = Infinity;
    for (const s of game.settlers) {
      if (s.dead || s.downed) continue;
      const d = Math.hypot(s.x - r.x, s.y - r.y);
      if (d < bestD) {
        bestD = d;
        best = { id: s.id, x: s.x, y: s.y };
      }
    }
    for (const t of game.structures) {
      if (!t.built || t.kind !== "turret") continue;
      const x = tileCenterX(t.tx);
      const y = tileCenterY(t.ty);
      const d = Math.hypot(x - r.x, y - r.y);
      if (d < bestD) {
        bestD = d;
        best = { id: -1, x, y };
      }
    }
    return best;
  }

  private goalTile(game: Game, target: { x: number; y: number } | null): { tx: number; ty: number } | null {
    if (target) return { tx: tileOfPixelX(target.x), ty: tileOfPixelY(target.y) };
    return game.world.landing;
  }

  private pathToEdge(game: Game, r: Raider): void {
    const from = { tx: tileOfPixelX(r.x), ty: tileOfPixelY(r.y) };
    let best: { tx: number; ty: number } | null = null;
    let bestD = Infinity;
    for (const sp of game.world.spawns) {
      const d = Math.hypot(sp.tx - from.tx, sp.ty - from.ty);
      if (d < bestD) {
        bestD = d;
        best = sp;
      }
    }
    if (best) {
      const path = findPath(game.world, from, best, true);
      r.path = path ?? [];
      r.pathIdx = 0;
    }
  }
}

// ---- Shooting resolution (settlers, turrets, raiders) ---------------------------
export function resolveShooting(game: Game, dt: number): void {
  // Settlers who are fighting fire on the nearest raider in range and line of sight.
  for (const s of game.settlers) {
    s.fireCooldown = Math.max(0, s.fireCooldown - dt);
    if (s.dead || s.downed || s.activity !== "fight") continue;
    const target = nearestRaider(game, s.x, s.y, SETTLER_RANGE);
    if (!target) continue;
    s.facing = Math.atan2(target.y - s.y, target.x - s.x);
    if (s.fireCooldown > 0) continue;
    s.fireCooldown = 1 / SETTLER_FIRE_RATE;
    fire(game, s.x, s.y, target.x, target.y, SETTLER_RANGE, SETTLER_BASE_HIT, s.skills.shoot, false, () => hitRaider(game, target, SETTLER_DMG));
  }

  // Turrets fire autonomously.
  for (const t of game.structures) {
    if (!t.built || t.kind !== "turret" || t.hp <= 0) continue;
    t.cooldown = Math.max(0, t.cooldown - dt);
    const cx = tileCenterX(t.tx);
    const cy = tileCenterY(t.ty);
    const target = nearestRaider(game, cx, cy, TURRET_RANGE);
    t.active = !!target;
    if (!target) continue;
    t.aim = Math.atan2(target.y - cy, target.x - cx);
    if (t.cooldown > 0) continue;
    t.cooldown = 1 / TURRET_FIRE_RATE;
    fire(game, cx, cy, target.x, target.y, TURRET_RANGE, TURRET_HIT, 0, false, () => hitRaider(game, target, TURRET_DMG));
  }

  // Raiders fire on the nearest settler or turret in range and line of sight.
  for (const r of game.raiders) {
    r.fireCooldown = Math.max(0, r.fireCooldown - dt);
    if (r.dead || r.fleeing) continue;
    const target = nearestColonyTarget(game, r.x, r.y, RAIDER_RANGE);
    if (!target) continue;
    r.facing = Math.atan2(target.y - r.y, target.x - r.x);
    if (r.fireCooldown > 0) continue;
    r.fireCooldown = 1 / RAIDER_FIRE_RATE;
    fire(game, r.x, r.y, target.x, target.y, RAIDER_RANGE, RAIDER_HIT, 0, true, () => target.apply(RAIDER_DMG));
  }
}

interface RaiderTarget {
  id: number;
  x: number;
  y: number;
}
function nearestRaider(game: Game, x: number, y: number, range: number): (Raider & RaiderTarget) | null {
  let best: Raider | null = null;
  let bestD = range;
  const stx = tileOfPixelX(x);
  const sty = tileOfPixelY(y);
  for (const r of game.raiders) {
    if (r.dead) continue;
    const d = Math.hypot(r.x - x, r.y - y);
    if (d > bestD) continue;
    if (!game.world.lineOfSight(stx, sty, tileOfPixelX(r.x), tileOfPixelY(r.y))) continue;
    bestD = d;
    best = r;
  }
  return best;
}

// A raider's target inside the colony (a settler or a turret), with an apply() that lands
// the damage on whichever it is.
interface ColonyTarget {
  x: number;
  y: number;
  apply(dmg: number): void;
}
function nearestColonyTarget(game: Game, x: number, y: number, range: number): ColonyTarget | null {
  let best: ColonyTarget | null = null;
  let bestD = range;
  const stx = tileOfPixelX(x);
  const sty = tileOfPixelY(y);
  const consider = (tx: number, ty: number, cand: ColonyTarget): void => {
    const d = Math.hypot(cand.x - x, cand.y - y);
    if (d > bestD) return;
    if (!game.world.lineOfSight(stx, sty, tx, ty)) return;
    bestD = d;
    best = cand;
  };
  for (const s of game.settlers) {
    if (s.dead || s.downed) continue;
    consider(tileOfPixelX(s.x), tileOfPixelY(s.y), { x: s.x, y: s.y, apply: (dmg) => hitSettler(game, s, dmg) });
  }
  for (const t of game.structures) {
    if (!t.built || t.kind !== "turret" || t.hp <= 0) continue;
    const cx = tileCenterX(t.tx);
    const cy = tileCenterY(t.ty);
    consider(t.tx, t.ty, { x: cx, y: cy, apply: (dmg) => hitTurret(game, t, dmg) });
  }
  return best;
}

// One resolved shot: cover from the target's near-side wall, range/skill falloff, the hit
// roll, and the tracer + muzzle flash + gunshot cue. `onHit` lands the damage.
function fire(
  game: Game,
  sx: number,
  sy: number,
  tx: number,
  ty: number,
  range: number,
  baseHit: number,
  shootLevel: number,
  hostile: boolean,
  onHit: () => void,
): void {
  const dist = Math.hypot(tx - sx, ty - sy);
  const cover = game.world.inCover(tileOfPixelX(tx), tileOfPixelY(ty), tileOfPixelX(sx), tileOfPixelY(sy));
  const p = hitChance(baseHit, dist, range, cover, shootLevel);
  game.tracers.push({ x0: sx, y0: sy, x1: tx, y1: ty, life: TRACER_LIFE, hostile });
  game.pushFx("muzzle", sx, sy);
  game.pushCue("gunshot");
  if (game.rng.chance(p)) onHit();
}

function hitRaider(game: Game, r: Raider, dmg: number): void {
  if (r.dead) return;
  r.health -= dmg;
  game.pushFx("blood", r.x, r.y);
  game.pushCue("hit");
  if (r.health <= 0) {
    r.dead = true;
    game.score.raidersKilled += 1;
    game.threat.onRaiderKilled();
    game.pushFx("blood", r.x, r.y);
  }
}

function hitSettler(game: Game, s: Settler, dmg: number): void {
  if (s.dead || s.downed) return;
  s.health -= dmg;
  game.pushFx("blood", s.x, s.y);
  game.pushCue("hit");
  if (s.health <= 0) game.downSettler(s);
}

function hitTurret(game: Game, t: Structure, dmg: number): void {
  if (t.hp <= 0) return;
  const cx = tileCenterX(t.tx);
  const cy = tileCenterY(t.ty);
  t.hp -= dmg;
  game.pushFx("impact", cx, cy);
  game.pushCue("hit");
  if (t.hp <= 0) game.destroyTurret(t);
}

// ---- Downed / bleed-out --------------------------------------------------------
export function updateDowned(game: Game, dt: number): void {
  for (const s of game.settlers) {
    if (!s.downed || s.dead) continue;
    s.bleed -= dt;
    if (s.bleed <= 0) game.killSettler(s);
  }
}

export const BLEED_SECONDS = BLEED; // re-export for the sim/harness readability
