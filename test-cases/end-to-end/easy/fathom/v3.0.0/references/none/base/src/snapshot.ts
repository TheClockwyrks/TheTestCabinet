// Fathom — the snapshot the debugging surface reads.
//
// `specs/state.md` defines one plain, JSON-serializable object carrying every
// observable fact about the game, and this file is the projection of the live
// state onto it. It is a PURE READ: nothing here writes a field, advances a
// timer, or asks a system to recompute anything.
//
// The snapshot is a projection rather than a translation. Every name below is
// the specification's own, and the values are read straight off the state the
// tick left, so what a scenario poses is what it reads back.

import {
  FATHOM_DEBUG_VERSION,
  FLARE_RADIUS,
  GLOAMFIN_HEAR,
  GRID_COLS,
  GRID_ORIGIN_X,
  GRID_ORIGIN_Y,
  GRID_ROWS,
  INK_RADIUS,
  TILE,
} from "./constants";
import type { FathomState } from "./game";
import { lightDetectRange, isBlooming, isCharging } from "./predators";
import { drifterLit, predatorLit, sonarRange, visionRadius } from "./readings";
import { tileKey } from "./sensing";
import type {
  Dir,
  PredatorKind,
  PredatorState,
  PulseSource,
  PulseTint,
  Screen,
} from "./types";

export interface ForagerSnapshot {
  x: number;
  y: number;
  tx: number;
  ty: number;
  dir: Dir;
  moving: boolean;
}

export interface DrifterSnapshot {
  x: number;
  y: number;
  tx: number;
  ty: number;
  lit: boolean;
  mind: boolean;
  travel: boolean;
}

export interface PredatorSnapshot {
  kind: PredatorKind;
  x: number;
  y: number;
  tx: number;
  ty: number;
  dir: Dir;
  state: PredatorState;
  released: boolean;
  mind: boolean;
  travel: boolean;
  speed: number;
  alert: boolean;
  lit: boolean;
  detectRange: number | null;
  hearingRange: number | null;
  hearingLock: boolean | null;
  flareCharging: boolean | null;
  flaring: boolean | null;
  flareRadius: number | null;
}

export interface PulseSnapshot {
  source: PulseSource;
  tint: PulseTint;
  ox: number;
  oy: number;
  front: number;
  range: number;
}

export interface InkCloudSnapshot {
  x: number;
  y: number;
  radius: number;
  remaining: number;
}

export interface FathomSnapshot {
  version: number;
  screen: Screen;
  depth: number;
  score: number;
  lives: number;
  muted: boolean;
  autoStep: boolean;
  planktonRemaining: number;
  brightness: number;
  brightHold: number;
  visionRadius: number;
  sonar: { ready: boolean; cooldown: number; range: number };
  ink: { ready: boolean; cooldown: number };
  grid: {
    cols: number;
    rows: number;
    tile: number;
    originX: number;
    originY: number;
  };
  tiles: string[];
  plankton: string[];
  visibility: string[];
  forager: ForagerSnapshot;
  drifters: DrifterSnapshot[];
  predators: PredatorSnapshot[];
  pulses: PulseSnapshot[];
  inkClouds: InkCloudSnapshot[];
  simTime: number;
}

/**
 * Where the plankton stand this instant, one row per grid row in the alphabet
 * `specs/state.md` fixes: `*` a tile holding one, `-` a tile holding none.
 *
 * Rock, the gate and the den chamber hold none, which the game keeps true of the
 * layer itself rather than masking here.
 */
function planktonRows(state: FathomState): string[] {
  const rows: string[] = [];
  for (let row = 0; row < GRID_ROWS; row += 1) {
    let line = "";
    for (let col = 0; col < GRID_COLS; col += 1) {
      line += state.plankton[tileKey(col, row)] ? "*" : "-";
    }
    rows.push(line);
  }
  return rows;
}

/**
 * The whole observable state, as `specs/state.md` defines it.
 *
 * `autoStep` is handed in rather than read off the state, because the clock
 * belongs to the runtime beneath the game and the game itself never asks
 * whether it is being driven.
 */
export function snapshot(
  state: FathomState,
  autoStep: boolean,
): FathomSnapshot {
  const forager = state.forager;
  return {
    version: FATHOM_DEBUG_VERSION,
    screen: state.screen,
    depth: state.depth,
    score: state.score,
    lives: state.lives,
    muted: state.muted,
    autoStep,
    planktonRemaining: state.planktonRemaining,
    brightness: forager.brightness,
    brightHold: forager.hold,
    visionRadius: visionRadius(state),
    sonar: {
      ready: state.sonarCooldown <= 0,
      cooldown: state.sonarCooldown,
      range: sonarRange(state.depth),
    },
    ink: { ready: state.inkCooldown <= 0, cooldown: state.inkCooldown },
    grid: {
      cols: GRID_COLS,
      rows: GRID_ROWS,
      tile: TILE,
      originX: GRID_ORIGIN_X,
      originY: GRID_ORIGIN_Y,
    },
    tiles: state.maze.rows(),
    plankton: planktonRows(state),
    visibility: state.fog.rows(),
    forager: {
      x: forager.x,
      y: forager.y,
      tx: forager.col,
      ty: forager.row,
      dir: forager.dir ?? forager.facing,
      moving: forager.dir !== null,
    },
    drifters: state.drifters.map((d) => ({
      x: d.x,
      y: d.y,
      tx: d.col,
      ty: d.row,
      lit: drifterLit(state, d),
      mind: d.mind,
      travel: d.travel,
    })),
    predators: state.predators.map((p) => {
      const hunts = p.kind === "lanternjaw" || p.kind === "flarefish";
      const gloamfin = p.kind === "gloamfin";
      const flarefish = p.kind === "flarefish";
      return {
        kind: p.kind,
        x: p.x,
        y: p.y,
        tx: p.col,
        ty: p.row,
        dir: p.dir ?? p.facing,
        state: p.state,
        released: p.released,
        mind: p.mind,
        travel: p.travel,
        speed: p.speed,
        alert: p.alertT > 0,
        lit: predatorLit(state, p),
        detectRange: hunts ? lightDetectRange(forager.brightness) : null,
        hearingRange: gloamfin ? GLOAMFIN_HEAR : null,
        hearingLock: gloamfin ? p.hearingLock : null,
        flareCharging: flarefish ? isCharging(p) : null,
        flaring: flarefish ? isBlooming(p) : null,
        flareRadius: flarefish ? (isBlooming(p) ? FLARE_RADIUS : 0) : null,
      };
    }),
    pulses: state.waves.map((wave) => ({
      source: wave.source,
      tint: wave.tint,
      ox: wave.origin.col,
      oy: wave.origin.row,
      front: wave.front,
      range: wave.range,
    })),
    inkClouds: state.ink.all.map((cloud) => ({
      x: cloud.x,
      y: cloud.y,
      radius: INK_RADIUS,
      remaining: cloud.remaining,
    })),
    simTime: state.simTime,
  };
}
