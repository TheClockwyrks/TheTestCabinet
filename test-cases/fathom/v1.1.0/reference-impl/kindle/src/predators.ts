// Fathom — the three predators (specs/predators.md). Each hunts a different
// signal the forager gives off: the Lanternjaw tracks light, the Gloamfin tracks
// sound, the Flarefish sees only in its own flare. This module owns their den
// release, per-kind sensing, tells, the detection alert, and greedy/patrol
// movement; the generic tile-locked stepping lives in entities.ts.

import {
  COLOR,
  COLS,
  DETECT_FLASH_TIME,
  DRIFTER_SPEED,
  FLARE_BLOOM,
  FLARE_CHARGE,
  FLARE_FADE,
  FLARE_INTERVAL,
  FLARE_LINGER,
  FLARE_RADIUS,
  FLARE_REARM,
  FLAREFISH_SPEED,
  GATE_COL,
  GATE_ROW,
  GLOAMFIN_CHASE_RECOVER,
  GLOAMFIN_CHASE_SPEED,
  GLOAMFIN_CORNER_SPEED,
  GLOAMFIN_HEAR_RANGE,
  GLOAMFIN_PATROL_SPEED,
  GLOAMFIN_PING_INTERVAL,
  GLOAMFIN_PING_MIN_GAP,
  GLOAMFIN_PING_RANGE,
  GLOAMFIN_SEARCH_PING_DELAY,
  GLOAMFIN_SEARCH_TIME,
  LANTERNJAW_LINGER,
  LANTERNJAW_RANGE_BASE,
  LANTERNJAW_RANGE_GAIN,
  LANTERNJAW_SPEED,
  ROWS,
  TILE,
} from "./constants";
import {
  advance,
  CanEnter,
  Drifter,
  Forager,
  Mover,
  Predator,
  wanderDir,
} from "./entities";
import { Effects } from "./effects";
import { Maze } from "./maze";
import { Fog } from "./sensing";
import { Dir, opposite, PredKind, PredState } from "./types";
import type { Audio } from "./audio";

export interface World {
  maze: Maze;
  fog: Fog;
  effects: Effects;
  audio: Audio;
  forager: Forager;
  fcol: number;
  frow: number;
  depthMult: number;
  predators: Predator[];
  drifters: Drifter[];
  rand: () => number;
  inkAt: (x: number, y: number) => boolean;
  inkBetween: (x1: number, y1: number, x2: number, y2: number) => boolean;
}

const DIRS = [Dir.Up, Dir.Down, Dir.Left, Dir.Right];

function dist(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(ax - bx, ay - by);
}

function manhattan(ac: number, ar: number, bc: number, br: number): number {
  return Math.abs(ac - bc) + Math.abs(ar - br);
}

// Greedy: the open direction that most reduces grid distance to the target.
// This alone can wedge a hunter in an L-corner (it walks into the corner nearest
// the target and can go no closer), so it is used only for the short den exit and
// as a fallback; the real chase steers by pathDir below. Reversing IS allowed here
// (unlike patrol) so a hunter that acquires you behind it turns around immediately
// (specs/predators.md); a small bias to the current heading avoids jitter on ties.
function greedyDir(
  p: Mover,
  tc: number,
  tr: number,
  canEnter: CanEnter,
  maze: Maze,
): Dir {
  let best: Dir = Dir.None;
  let bestD = Infinity;
  for (const d of DIRS) {
    const n = maze.step(p.col, p.row, d);
    if (!canEnter(n.col, n.row)) continue;
    let dd = manhattan(n.col, n.row, tc, tr);
    if (d === p.dir) dd -= 0.1;
    if (dd < bestD) {
      bestD = dd;
      best = d;
    }
  }
  return best === Dir.None ? p.dir : best;
}

// Pathfinding chase: the first step of the shortest corridor path to the target,
// so a hunter rounds walls to its fix (and to your last-known tile once it loses
// line of sight) instead of stalling in an L-corner (specs/predators.md). Falls
// back to the greedy step only if no path exists (e.g. the target is walled off).
function pathDir(
  p: Mover,
  tc: number,
  tr: number,
  canEnter: CanEnter,
  maze: Maze,
): Dir {
  const d = maze.firstStepToward(p.col, p.row, tc, tr, canEnter);
  return d !== Dir.None ? d : greedyDir(p, tc, tr, canEnter, maze);
}

// Random wander: an open direction, avoiding an immediate reverse when possible.
function patrolDir(
  p: Mover,
  canEnter: CanEnter,
  maze: Maze,
  rand: () => number,
): Dir {
  const opts: Dir[] = [];
  for (const d of DIRS) {
    const n = maze.step(p.col, p.row, d);
    if (canEnter(n.col, n.row)) opts.push(d);
  }
  const noRev = opts.filter((d) => d !== opposite(p.dir));
  const pool = noRev.length ? noRev : opts;
  if (!pool.length) return Dir.None;
  // Keep going straight if that stays open, most of the time, for readable lines.
  if (pool.includes(p.dir) && rand() < 0.55) return p.dir;
  return pool[Math.floor(rand() * pool.length)];
}

// The flare reveals a full radial disc — floor and wall, straight through walls
// (it ignores rock) — to the player, and shows anything caught in the bloom
// (specs/predators.md, specs/sensing.md).
function revealFlareArea(p: Predator, w: World): void {
  const rad = Math.ceil(FLARE_RADIUS / TILE) + 1;
  const R2 = FLARE_RADIUS * FLARE_RADIUS;
  for (let r = p.row - rad; r <= p.row + rad; r++) {
    if (r < 0 || r >= ROWS) continue;
    for (let c = p.col - rad; c <= p.col + rad; c++) {
      if (c < 0 || c >= COLS) continue;
      const dx = Maze.cx(c) - p.x;
      const dy = Maze.cy(r) - p.y;
      if (dx * dx + dy * dy > R2) continue;
      w.fog.reveal(c, r); // walls and floor alike; no line-of-sight check
    }
  }
  // Any predator or a drifter within the disc is shown live (walls ignored).
  const others: Mover[] = [...w.predators, ...w.drifters];
  for (const o of others) {
    if (o === p) continue;
    if (dist(o.x, o.y, p.x, p.y) <= FLARE_RADIUS) o.markT = Math.max(o.markT, 0.12);
  }
}

// A predator (Gloamfin or Flarefish) takes a fresh fix on the forager: it enters
// its chase and, on a *fresh* acquisition, fires the detection alert so the player
// knows they were spotted (specs/predators.md). Returns true if it was fresh.
export function acquire(p: Predator, w: World, col: number, row: number): boolean {
  const alreadyChasing = p.hasFix && !p.searching && p.state === PredState.Hunt;
  p.hasFix = true;
  p.fixCol = col;
  p.fixRow = row;
  p.searching = false;
  p.state = PredState.Hunt;
  if (!alreadyChasing) {
    // A fresh chase opens at the Gloamfin's full +5% cap (a corner will trim it
    // later); harmless for the Flarefish, which does not read chaseSpeed.
    p.chaseSpeed = GLOAMFIN_CHASE_SPEED;
    p.alertT = DETECT_FLASH_TIME;
    const color = p.kind === PredKind.Gloamfin ? COLOR.gloamfin : COLOR.flarefish;
    w.effects.addBurst(p.x, p.y, color);
    w.audio.play("alert");
  }
  return !alreadyChasing;
}

// ---- per-kind sensing --------------------------------------------------

function updateLanternjaw(p: Predator, dt: number, w: World, mult: number): void {
  let sensed = false;
  if (p.blindT <= 0) {
    const R = LANTERNJAW_RANGE_BASE + LANTERNJAW_RANGE_GAIN * w.forager.g;
    if (
      dist(p.x, p.y, w.forager.x, w.forager.y) <= R &&
      Fog.losClear(w.maze, p.col, p.row, w.fcol, w.frow) &&
      !w.inkBetween(p.x, p.y, w.forager.x, w.forager.y)
    ) {
      sensed = true;
    }
  }
  if (sensed) {
    p.hasFix = true;
    p.fixCol = w.fcol;
    p.fixRow = w.frow;
    p.linger = LANTERNJAW_LINGER;
    p.state = PredState.Hunt;
  } else if (p.blindT > 0) {
    p.hasFix = false;
    p.linger = 0;
    p.state = PredState.Patrol;
  } else if (p.linger > 0) {
    p.linger -= dt;
    p.state = PredState.Hunt;
    if (p.linger <= 0) {
      p.hasFix = false;
      p.state = PredState.Patrol;
    }
  } else {
    p.hasFix = false;
    p.state = PredState.Patrol;
  }

  // Speed: it hunts at its own pace, but while undetected it drifts at EXACTLY
  // the bonus drifter's speed (and its wander routing matches too, below), so its
  // always-visible bulb cannot be told apart from a drifter until it finds you
  // (specs/predators.md). The drift speed is depth-independent, like the drifter.
  p.speed = p.state === PredState.Hunt ? LANTERNJAW_SPEED * mult : DRIFTER_SPEED;
}

// Emit a Gloamfin sonar ping: its violet ring (a visible tell) plus its sense.
// The ring reveals NOTHING of the maze (specs/sensing.md) — it only marks the
// Gloamfin's own position briefly and, if the flood reaches the forager, gives a
// fix and fires the alert.
function gloamfinPing(p: Predator, w: World): void {
  w.effects.addRing(p.x, p.y, GLOAMFIN_PING_RANGE * TILE, true);
  w.audio.play("predPulse");
  // The ping is a warning you can SEE (the ring) but it does NOT give away the
  // Gloamfin itself — the source stays hidden in the dark (specs/predators.md), so
  // we do not mark it here. It is revealed only by your light, your sonar, or the
  // detection alert when a ping actually catches you.
  // Every ping (periodic or the guaranteed "lost you" one) restarts the standard
  // cadence AND arms a minimum spacing, so re-acquiring you at close range cannot
  // spin the search→ping→re-acquire loop into a rapid-fire burst (specs/predators.md).
  p.pulseT = GLOAMFIN_PING_INTERVAL;
  p.pingLock = GLOAMFIN_PING_MIN_GAP;
  for (const cell of w.maze.flood(p.col, p.row, GLOAMFIN_PING_RANGE)) {
    if (cell.col === w.fcol && cell.row === w.frow) {
      acquire(p, w, w.fcol, w.frow);
      break;
    }
  }
}

function updateGloamfin(p: Predator, dt: number, w: World): void {
  if (p.pingLock > 0) p.pingLock = Math.max(0, p.pingLock - dt);

  // Very-close hearing: it always knows your tile within ~2 tiles. While you are
  // in that range it has a *continuous* lock straight off its hearing, so it does
  // NOT ping — an earlier build kept firing pings on top of you as it closed in,
  // and up close (chase → arrive → guaranteed "lost you" ping → re-acquire → ...)
  // that spun into a near-continuous stutter of pings. Suppressing the ping inside
  // hearing range keeps it silent right when it is already on you (specs/predators.md).
  const closeLock = dist(p.x, p.y, w.forager.x, w.forager.y) <= GLOAMFIN_HEAR_RANGE;
  if (closeLock) {
    acquire(p, w, w.fcol, w.frow);
  }

  // Periodic ping (its tell + sense). Fires in every state, but never sooner than
  // the minimum ping spacing (gloamfinPing resets both timers), and never while it
  // already holds a close-range hearing lock. (pulseT keeps counting down through
  // the lock, so the instant you slip back out of hearing range it pings to re-find
  // you.)
  p.pulseT -= dt;
  if (p.pulseT <= 0 && p.pingLock <= 0 && !closeLock) {
    gloamfinPing(p, w);
  }

  const mult = w.depthMult;
  if (p.hasFix && !p.searching) {
    // Chase: drive to the tile the ping caught you on, ramping the chase speed back
    // up to its cap. A corner turn (detected after the move in updatePredator) will
    // have knocked chaseSpeed down to the corner floor.
    p.chaseSpeed = Math.min(
      GLOAMFIN_CHASE_SPEED,
      p.chaseSpeed + GLOAMFIN_CHASE_RECOVER * dt,
    );
    p.speed = p.chaseSpeed * mult;
    if (p.col === p.fixCol && p.row === p.fixRow) {
      // Reached it and you are gone — start casting about.
      p.searching = true;
      p.searchT = GLOAMFIN_SEARCH_TIME;
      p.searchPingT = GLOAMFIN_SEARCH_PING_DELAY;
      p.speed = GLOAMFIN_PATROL_SPEED * mult;
    }
  } else if (p.searching) {
    p.speed = GLOAMFIN_PATROL_SPEED * mult;
    p.searchT -= dt;
    // A single guaranteed "lost you" ping a moment after arriving; it resets the
    // standard ping cadence (specs/predators.md). It still respects the minimum
    // ping spacing, so it holds until the lock clears rather than firing right on
    // top of the ping that just caught you.
    if (p.searchPingT !== Infinity) {
      p.searchPingT -= dt;
      if (p.searchPingT <= 0 && p.pingLock <= 0 && !closeLock) {
        gloamfinPing(p, w);
        p.searchPingT = Infinity;
      }
    }
    if (p.searchT <= 0) {
      // Gave up.
      p.searching = false;
      p.hasFix = false;
      p.state = PredState.Patrol;
    }
  } else {
    p.speed = GLOAMFIN_PATROL_SPEED * mult;
    p.state = PredState.Patrol;
  }
}

function updateFlarefish(p: Predator, dt: number, w: World, mult: number): void {
  p.speed = FLAREFISH_SPEED * mult;
  const chasing = p.hasFix;

  if (!chasing) {
    // Wander (no tell but the flare), running the flare cycle.
    if (!p.flaring) {
      p.flareT -= dt;
      if (p.flareT <= 0) {
        p.flaring = true;
        p.flarePhaseT = 0;
        p.flareT = FLARE_INTERVAL;
      }
    }
    if (p.flaring) {
      const prev = p.flarePhaseT;
      p.flarePhaseT += dt;
      const bloomStart = FLARE_CHARGE;
      const bloomEnd = FLARE_CHARGE + FLARE_BLOOM;
      const fadeEnd = bloomEnd + FLARE_FADE;
      if (prev < bloomStart && p.flarePhaseT >= bloomStart) {
        w.audio.play("flare");
      }
      // While the flare is at full bloom it is a persistent, full-vision light disc
      // stuck to the Flarefish: reveal it for the player every frame, and catch the
      // forager the instant it is ANYWHERE inside — including if it was clear at the
      // bloom but then drifts into the still-burning light (specs/predators.md). The
      // flare ignores walls (radius only, no line of sight); ink still breaks it.
      if (p.flaring && p.flarePhaseT >= bloomStart && p.flarePhaseT < bloomEnd) {
        revealFlareArea(p, w);
        const blinded =
          p.blindT > 0 ||
          w.inkAt(w.forager.x, w.forager.y) ||
          w.inkBetween(p.x, p.y, w.forager.x, w.forager.y);
        if (dist(p.x, p.y, w.forager.x, w.forager.y) <= FLARE_RADIUS && !blinded) {
          acquire(p, w, w.fcol, w.frow);
          p.linger = FLARE_LINGER;
          p.flaring = false; // it has you now — the chase takes over
        }
      }
      if (p.flaring && p.flarePhaseT >= fadeEnd) p.flaring = false;
    }
    p.state = PredState.Patrol;
    return;
  }

  // Chase — exactly like the Lanternjaw (brightness range + line of sight + ink),
  // and no flaring while chasing.
  p.flaring = false;
  let sensed = false;
  if (p.blindT <= 0) {
    const R = LANTERNJAW_RANGE_BASE + LANTERNJAW_RANGE_GAIN * w.forager.g;
    if (
      dist(p.x, p.y, w.forager.x, w.forager.y) <= R &&
      Fog.losClear(w.maze, p.col, p.row, w.fcol, w.frow) &&
      !w.inkBetween(p.x, p.y, w.forager.x, w.forager.y)
    ) {
      sensed = true;
    }
  }
  if (sensed) {
    p.fixCol = w.fcol;
    p.fixRow = w.frow;
    p.linger = FLARE_LINGER;
    p.state = PredState.Hunt;
  } else if (p.blindT > 0) {
    loseFlareChase(p);
  } else {
    p.linger -= dt;
    p.state = PredState.Hunt;
    if (p.linger <= 0) loseFlareChase(p);
  }
}

// The Flarefish loses you: back to wandering + invisibility, with the flare put on
// a fresh timer so you get a moment to escape (specs/predators.md).
function loseFlareChase(p: Predator): void {
  p.hasFix = false;
  p.linger = 0;
  p.state = PredState.Patrol;
  p.flaring = false;
  p.flareT = FLARE_REARM;
}

// ---- per-step update ---------------------------------------------------

export function updatePredator(p: Predator, dt: number, w: World): void {
  const mult = w.depthMult;
  if (p.markT > 0) p.markT = Math.max(0, p.markT - dt);
  if (p.blindT > 0) p.blindT = Math.max(0, p.blindT - dt);
  if (p.alertT > 0) p.alertT = Math.max(0, p.alertT - dt);

  const canPatrol: CanEnter = (c, r) => w.maze.foragerOpen(c, r);
  const canDen: CanEnter = (c, r) => w.maze.predOpen(c, r);
  // A drifting Lanternjaw stays out of wrap-tunnel edges, exactly like the drifter.
  const canDrift: CanEnter = (c, r) =>
    w.maze.foragerOpen(c, r) && !w.maze.isWrapEdge(c, r);

  // Den: idle until release, then navigate up and out through the gate.
  if (p.state === PredState.Den) {
    p.denTimer -= dt;
    if (p.denTimer > 0) {
      p.dir = Dir.None;
      return;
    }
    p.speed = p.patrolSpeed * mult;
    advance(
      p,
      dt,
      w.maze,
      () => greedyDir(p, GATE_COL, GATE_ROW - 1, canDen, w.maze),
      canDen,
      () => true,
    );
    if (p.row <= GATE_ROW - 1 && !w.maze.isDen(p.col, p.row)) {
      p.state = PredState.Patrol;
    }
    return;
  }

  switch (p.kind) {
    case PredKind.Lanternjaw:
      updateLanternjaw(p, dt, w, mult);
      break;
    case PredKind.Gloamfin:
      updateGloamfin(p, dt, w);
      break;
    case PredKind.Flarefish:
      updateFlarefish(p, dt, w, mult);
      break;
  }

  // Movement: chase by pathfinding to the fix (so it rounds walls to you, and to
  // your last-known tile once it loses sight, instead of wedging in an L-corner);
  // a searching Gloamfin paths back to the fix then casts around it; otherwise
  // wander.
  let wantFn: () => Dir;
  let moveCanEnter: CanEnter = canPatrol;
  if (p.kind === PredKind.Gloamfin && p.searching) {
    wantFn = () =>
      manhattan(p.col, p.row, p.fixCol, p.fixRow) > 2
        ? pathDir(p, p.fixCol, p.fixRow, canPatrol, w.maze)
        : patrolDir(p, canPatrol, w.maze, w.rand);
  } else if (p.state === PredState.Hunt && p.hasFix) {
    wantFn = () => pathDir(p, p.fixCol, p.fixRow, canPatrol, w.maze);
  } else if (p.kind === PredKind.Lanternjaw) {
    // Undetected: wander EXACTLY like the bonus drifter (same routing here, same
    // speed set in updateLanternjaw) so the bulb is indistinguishable from one.
    wantFn = () => wanderDir(p, w.maze, w.rand);
    moveCanEnter = canDrift;
  } else {
    wantFn = () => patrolDir(p, canPatrol, w.maze, w.rand);
  }

  const prevDir = p.dir;
  advance(p, dt, w.maze, wantFn, moveCanEnter, () => true);

  // Gloamfin corner brake: turning a corner mid-chase (a perpendicular turn — not
  // a straight run and not a free reversal) drops it below the forager's speed for
  // a beat before it ramps back to the +5% cap, so a player who keeps cornering can
  // pull away and escape rather than being reeled in on a straight line
  // (specs/predators.md).
  if (
    p.kind === PredKind.Gloamfin &&
    p.hasFix &&
    !p.searching &&
    p.dir !== Dir.None &&
    prevDir !== Dir.None &&
    p.dir !== prevDir &&
    p.dir !== opposite(prevDir)
  ) {
    p.chaseSpeed = GLOAMFIN_CORNER_SPEED;
  }
}
