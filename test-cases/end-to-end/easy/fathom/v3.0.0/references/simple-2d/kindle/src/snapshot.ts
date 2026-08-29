// Fathom — the snapshot the debug surface reads (`specs/state.md`).
//
// A pure projection of `FathomState` into a plain, JSON-serializable object. It
// changes nothing and derives nothing the game does not already hold: the tile
// alphabet and the visibility alphabet come off the same maze and the same fog
// the renderer draws, the light radius comes off the brightness by the formula
// `specs/sensing.md` gives, and each predator's per-kind fields are `null` where
// its kind does not carry them rather than going missing.

import {
  FLARE_RADIUS,
  GLOAMFIN_HEAR,
  GRID_COLS,
  GRID_ORIGIN_X,
  GRID_ORIGIN_Y,
  GRID_ROWS,
  TILE,
  type PredatorKind,
} from "./constants";
import { bodyTile } from "./entities";
import { detectRange, flareCharging, flaring } from "./predators";
import {
  drifterLit,
  visibilityRows,
  visionRadius,
  windowRadius,
} from "./sensing";
import { sonarRange } from "./sonar";
import type {
  Dir,
  FathomState,
  PredatorMode,
  PredatorState,
  PulseSource,
  PulseTint,
  Screen,
} from "./state";

/** One predator, as `specs/state.md` reports it. */
export interface PredatorSnapshot {
  kind: PredatorKind;
  x: number;
  y: number;
  tx: number;
  ty: number;
  dir: Dir;
  state: PredatorMode;
  released: boolean;
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

/** The whole observable state, as `specs/state.md` reports it. */
export interface FathomSnapshot {
  version: number;
  screen: Screen;
  depth: number;
  score: number;
  lives: number;
  muted: boolean;
  creatureAI: boolean;
  planktonRemaining: number;
  brightness: number;
  visionRadius: number;
  windowRadius: number;
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
  visibility: string[];
  forager: {
    x: number;
    y: number;
    tx: number;
    ty: number;
    dir: Dir;
    moving: boolean;
  };
  drifters: {
    x: number;
    y: number;
    tx: number;
    ty: number;
    lit: boolean;
  }[];
  predators: PredatorSnapshot[];
  pulses: {
    source: PulseSource;
    tint: PulseTint;
    ox: number;
    oy: number;
    front: number;
    range: number;
  }[];
  inkClouds: { x: number; y: number; radius: number; remaining: number }[];
  simTime: number;
}

/** One predator's entry, with the fields its kind does not carry as `null`. */
function predatorSnapshot(
  p: PredatorState,
  brightness: number,
): PredatorSnapshot {
  const at = bodyTile(p);
  const sight = p.kind === "lanternjaw" || p.kind === "flarefish";
  const hears = p.kind === "gloamfin";
  const flares = p.kind === "flarefish";
  return {
    kind: p.kind,
    x: p.x,
    y: p.y,
    tx: at.tx,
    ty: at.ty,
    dir: p.facing,
    state: p.mode,
    released: p.released,
    speed: p.speed,
    // The Lanternjaw fires no alert, so its window never opens.
    alert: p.alertIn > 0,
    lit: p.lit,
    detectRange: sight ? detectRange(brightness) : null,
    hearingRange: hears ? GLOAMFIN_HEAR : null,
    hearingLock: hears ? p.hearingLock : null,
    flareCharging: flares ? flareCharging(p) : null,
    flaring: flares ? flaring(p) : null,
    flareRadius: flares ? (flaring(p) ? FLARE_RADIUS : 0) : null,
  };
}

/** A pure reading of `state`. */
export function snapshotOf(
  state: FathomState,
  version: number,
): FathomSnapshot {
  const forager = bodyTile(state.forager);
  return {
    version,
    screen: state.screen,
    depth: state.depth,
    score: state.score,
    lives: state.lives,
    muted: state.muted,
    creatureAI: state.creatureAI,
    planktonRemaining: state.planktonRemaining,
    brightness: state.brightness,
    visionRadius: visionRadius(state.brightness),
    windowRadius: windowRadius(state.brightness),
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
    tiles: [...state.maze.rows],
    visibility: visibilityRows(state.revealed, state.lit),
    forager: {
      x: state.forager.x,
      y: state.forager.y,
      tx: forager.tx,
      ty: forager.ty,
      dir: state.forager.facing,
      moving: state.forager.heading !== null,
    },
    drifters: state.drifters.map((d) => {
      const at = bodyTile(d);
      return {
        x: d.x,
        y: d.y,
        tx: at.tx,
        ty: at.ty,
        lit: drifterLit(state.lit, d),
      };
    }),
    predators: state.predators.map((p) =>
      predatorSnapshot(p, state.brightness),
    ),
    pulses: state.pulses.map((pulse) => ({
      source: pulse.source,
      tint: pulse.tint,
      ox: pulse.ox,
      oy: pulse.oy,
      front: pulse.front,
      range: pulse.range,
    })),
    inkClouds: state.inkClouds.map((cloud) => ({
      x: cloud.x,
      y: cloud.y,
      radius: cloud.radius,
      remaining: cloud.remaining,
    })),
    simTime: state.simTime,
  };
}
