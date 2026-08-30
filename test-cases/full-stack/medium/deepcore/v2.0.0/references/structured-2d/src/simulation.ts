// Deepcore — one update of the mine (specs/gameplay.md).
//
// `stepGame` integrates one interval of game time against the delta time the
// frame was handed: it drills, moves the miner under physics, bills fuel and
// hull, applies the hazards and the Core Sample's timer, follows the camera, and
// picks the animation state and the loops that should be sounding. Every rate is
// per second, so an interval of game time reaches the same state however it was
// divided into frames.
//
// Nothing here reads the drawing or the canvas, so the whole simulation runs
// with no drawing surface taking part in the result. That is what makes a
// scenario driveable from code and testable in Node.

import {
  AIR_BURN,
  CUES,
  GAS_SEEP_PERIOD,
  LIFE_SUPPORT_BURN,
  LOW_FUEL_FRACTION,
  MINER_H,
  NOTICE_FADE,
  SURFACE_Y,
  THRUST_BURN_SIZE_MULT,
  TILE,
  VIEW_H,
  VIEW_W,
  WORLD_COLS,
} from "./constants";
import { updateCamera } from "./camera";
import { updateDrill } from "./drill";
import { fx } from "./feedback";
import {
  climbAccel,
  climbCap,
  depthMeters,
  fallTerminal,
  maxFuel,
} from "./figures";
import { landImpact, updateLavaContact } from "./hazards";
import { expireCoreTimer } from "./items";
import { DEATH_ANIM, finalizeDeath, makeSummary, triggerDeath } from "./modes";
import {
  minerCenterX,
  minerCol,
  minerFeetY,
  minerRow,
  stepMovement,
} from "./physics";
import type { MoveResult } from "./physics";
import { computeScan } from "./scanner";
import { clearSave, hasSave } from "./save";
import { Draws } from "./rng";
import { tileAt } from "./state";
import {
  buildingPlace,
  LAUNCH_ANIM_TIME,
  LAUNCH_RISE_SPEED,
  thrustBurnAt,
} from "./tuning";
import { isMinableKind, tileLeft } from "./world";
import type { DeepcoreState } from "./game";

/** Lateral speed above which the miner reads as walking. */
const WALK_READ_SPEED = 12;

/** Seconds between the exhaust bursts a held thrust throws off. */
const THRUST_FX_PERIOD = 0.06;

/** Seconds between the exhaust bursts the rising rocket throws off. */
const LAUNCH_FX_PERIOD = 0.12;

/** Advance the game by `dt` seconds of game time. */
export function stepGame(d: DeepcoreState, dt: number): void {
  // Accumulated game time runs on every screen, so a caller can clock a menu.
  d.simTime += dt;
  if (d.screen !== "in-mine") return;

  d.elapsedSeconds += dt;
  decayNotes(d, dt);
  if (d.hurtT > 0) d.hurtT = Math.max(0, d.hurtT - dt);
  if (d.shakeT > 0) {
    d.shakeT = Math.max(0, d.shakeT - dt);
    if (d.shakeT === 0) d.shakeAmp = 0;
  }
  advanceNotice(d, dt);

  // The Core Sample's timer runs everywhere the expedition does.
  if (d.coreTimer !== null) {
    d.coreTimer -= dt;
    if (d.coreTimer <= 0) {
      d.coreTimer = 0;
      expireCoreTimer(d);
    }
  }

  if (d.launchAnim !== null) {
    advanceLaunch(d, dt);
    return;
  }

  if (d.dying) {
    advanceDeath(d, dt);
    return;
  }

  if (d.panel !== null) {
    // The world holds still behind an overlay; the Core timer above still ran.
    if (d.coreTimer !== null) d.loops.add(CUES.alarmCore);
    updateCamera(d, dt);
    // specs/character.md: an empty hull is never a state the expedition
    // continues from, and no open panel or overlay suspends the check.
    if (d.miner.hull <= 0) triggerDeath(d, "hull-destroyed");
    return;
  }

  updateLive(d, dt);
}

function updateLive(d: DeepcoreState, dt: number): void {
  updateDrill(d, dt);
  const braced = d.miner.drilling !== null;

  let move: MoveResult;
  if (braced) {
    if (d.miner.travel) {
      d.miner.vx = 0;
      d.miner.vy = 0;
    }
    move = {
      grounded: true,
      thrusting: false,
      lateralAir: false,
      landedSpeed: 0,
    };
  } else {
    move = stepMovement(
      d.miner,
      d.grid,
      d.input,
      d.miner.fuel > 0,
      dt,
      climbAccel(d.cargo, d.tiers),
      climbCap(d.cargo, d.tiers),
      fallTerminal(d.cargo, d.tiers),
    );
  }

  if (move.thrusting) {
    d.thrustFxCd -= dt;
    if (d.thrustFxCd <= 0) {
      d.thrustFxCd = THRUST_FX_PERIOD;
      fx(d, "jetpack-exhaust", minerCenterX(d.miner), d.miner.y + MINER_H);
    }
  }

  // Fuel. The thrust burn eases with the upward speed and is the only drain the
  // world size scales; walking and standing still cost nothing.
  const underground = minerFeetY(d.miner) > SURFACE_Y;
  if (move.thrusting) {
    const up = Math.max(0, -d.miner.vy);
    d.miner.fuel -= thrustBurnAt(up) * THRUST_BURN_SIZE_MULT[d.worldSize] * dt;
  }
  if (move.lateralAir) d.miner.fuel -= AIR_BURN * dt;
  if (underground) d.miner.fuel -= LIFE_SUPPORT_BURN * dt;
  if (d.miner.fuel < 0) d.miner.fuel = 0;

  updateLavaContact(d, dt);
  if (move.landedSpeed > 0) landImpact(d, move.landedSpeed);

  emitGasSeeps(d, dt);

  d.deepestDepthMeters = Math.max(d.deepestDepthMeters, depthMeters(d.miner));
  updateCamera(d, dt);
  d.scan = { ...computeScan(d.miner, d.nodes, d.satchel, d.tiers) };
  updateAnimation(d, move, braced, underground);
  updateLoops(d, move, braced, underground);

  if (d.miner.fuel <= 0 && underground) triggerDeath(d, "fuel-out");
  else if (d.miner.hull <= 0) triggerDeath(d, "hull-destroyed");
}

function advanceLaunch(d: DeepcoreState, dt: number): void {
  d.launchAnim = (d.launchAnim ?? 0) + dt;
  d.thrustFxCd -= dt;
  if (d.thrustFxCd <= 0) {
    d.thrustFxCd = LAUNCH_FX_PERIOD;
    const pad = buildingPlace("launch-pad");
    fx(
      d,
      "launch-exhaust",
      tileLeft(pad.col) + TILE / 2,
      SURFACE_Y - d.launchAnim * LAUNCH_RISE_SPEED + 60,
      1.4,
    );
  }
  if (d.launchAnim >= LAUNCH_ANIM_TIME) {
    makeSummary(d, null);
    d.launchAnim = null;
    // A victory consumes the save.
    clearSave();
    d.hasSave = hasSave();
    d.menuIndex = 0;
    d.screen = "victory";
  }
}

function advanceDeath(d: DeepcoreState, dt: number): void {
  const dying = d.dying;
  if (!dying) return;
  dying.t += dt;
  d.miner.state = dying.cause === "fuel-out" ? "fuel-out" : "hurt";
  stepMovement(
    d.miner,
    d.grid,
    { left: false, right: false, down: false, thrust: false },
    false,
    dt,
    0,
    climbCap(d.cargo, d.tiers),
    fallTerminal(d.cargo, d.tiers),
  );
  updateCamera(d, dt);
  if (dying.t >= DEATH_ANIM) finalizeDeath(d);
}

function decayNotes(d: DeepcoreState, dt: number): void {
  for (const note of d.notes) note.t -= dt;
  d.notes = d.notes.filter((note) => note.t > 0);
}

function advanceNotice(d: DeepcoreState, dt: number): void {
  const notice = d.notice;
  if (!notice) return;
  notice.t -= dt;
  if (notice.t > 0) return;
  if (!notice.shown) {
    notice.shown = true;
    notice.t = NOTICE_FADE;
  } else {
    d.notice = null;
  }
}

/**
 * Wisp over each gas pocket on screen in turn, so every visible pocket breathes
 * within `GAS_SEEP_PERIOD` and a player watching a suspect cell catches it.
 */
function emitGasSeeps(d: DeepcoreState, dt: number): void {
  d.gasSeepCd -= dt;
  if (d.gasSeepCd > 0) return;
  const c0 = Math.max(0, Math.floor(d.camX / TILE));
  const c1 = Math.min(WORLD_COLS - 1, Math.floor((d.camX + VIEW_W) / TILE));
  const r0 = Math.max(0, Math.floor(d.camY / TILE));
  const r1 = Math.min(d.grid.length - 1, Math.floor((d.camY + VIEW_H) / TILE));
  const pockets: [number, number][] = [];
  for (let r = r0; r <= r1; r += 1) {
    const line = d.grid[r];
    if (!line) continue;
    for (let c = c0; c <= c1; c += 1) {
      if (line[c].kind === "gas") pockets.push([c, r]);
    }
  }
  if (pockets.length === 0) {
    d.gasSeepCd = GAS_SEEP_PERIOD;
    return;
  }
  d.gasSeepCd = GAS_SEEP_PERIOD / pockets.length;
  d.gasSeepIndex = (d.gasSeepIndex + 1) % pockets.length;
  const [c, r] = pockets[d.gasSeepIndex];
  // Scatter the wisp across the cell's face, clear of its very edges so it is
  // never ambiguous which cell is breathing.
  const draws = new Draws(d.rngState);
  const jx = 0.18 + draws.float() * 0.64;
  const jy = 0.18 + draws.float() * 0.64;
  d.rngState = draws.state;
  fx(d, "gas-seep", c * TILE + TILE * jx, r * TILE + TILE * jy);
}

function updateAnimation(
  d: DeepcoreState,
  move: MoveResult,
  braced: boolean,
  underground: boolean,
): void {
  const m = d.miner;
  if (d.input.left && !d.input.right) m.facing = "west";
  else if (d.input.right && !d.input.left) m.facing = "east";

  if (braced && m.drilling) {
    m.state = m.drilling.dir === "down" ? "drill-down" : "drill-side";
    if (m.drilling.dir === "left") m.facing = "west";
    else if (m.drilling.dir === "right") m.facing = "east";
    return;
  }
  // Hold the drilling pose across the single update between two down-cut cells,
  // or the miner flashes its standing frame mid-shaft.
  if (m.drill && d.input.down && move.grounded && minableBelow(d)) {
    m.state = "drill-down";
    return;
  }
  if (d.hurtT > 0) {
    m.state = "hurt";
    return;
  }
  if (underground && m.fuel <= 0) {
    m.state = "fuel-out";
    return;
  }
  if (move.thrusting) m.state = "jetpack";
  else if (!move.grounded) m.state = "fall";
  else if (move.grounded && Math.abs(m.vx) > WALK_READ_SPEED) m.state = "walk";
  else m.state = "idle";
}

function minableBelow(d: DeepcoreState): boolean {
  const tile = tileAt(d.grid, minerCol(d.miner), minerRow(d.miner) + 1);
  return !!tile && isMinableKind(tile.kind);
}

function updateLoops(
  d: DeepcoreState,
  move: MoveResult,
  braced: boolean,
  underground: boolean,
): void {
  if (braced) d.loops.add(CUES.drill);
  if (move.thrusting) d.loops.add(CUES.thrust);
  if (
    underground &&
    d.miner.fuel > 0 &&
    d.miner.fuel < maxFuel(d.tiers) * LOW_FUEL_FRACTION
  ) {
    d.loops.add(CUES.alarmFuel);
  }
  if (d.coreTimer !== null) d.loops.add(CUES.alarmCore);
}
