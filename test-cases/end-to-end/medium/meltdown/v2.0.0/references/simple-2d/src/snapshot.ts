// Meltdown — the snapshot the debug surface reads the game back through.
//
// specs/instrumentation.md fixes this object field for field. Everything in it
// is either a declared field of `MeltdownState` or something DERIVED from one
// at the call: the mode's figures, the routes, the panel's rectangles, and each
// tower's and unit's live stats. Nothing here is stored, which is why every
// operation on the surface is verifiable by setting a value and reading it
// back, and why the surface needs no setter for anything derived.

import { MELTDOWN_DEBUG_VERSION, TOWER_DEFS } from "./constants";
import { exhaustOf, sizeOf, tileAt, worldRadiators } from "./geometry";
import {
  buildZoneOf,
  interestOf,
  startLivesOf,
  startMoneyOf,
  waveCountOf,
  waveSizeOf,
  waveTypeOf,
} from "./modes";
import { controlsOf, menuRects, type Controls } from "./panel";
import { heldValid } from "./build";
import { routesOf } from "./routes";
import { remainingOf } from "./surge";
import {
  baseSpeedOf,
  damageOf,
  flying,
  heatMultOf,
  outputOf,
  redlineOf,
  refundOf,
  slowFactorOf,
  speedOf,
  upgradeCostOf,
} from "./stats";
import type {
  DifficultyName,
  ExhaustName,
  Face,
  ModeName,
  SurgeType,
  TowerType,
  VentName,
} from "./constants";
import type { MeltdownState, Phase, Screen } from "./game";

/** One tower, as the snapshot reports it. */
export interface TowerReport {
  readonly id: number;
  readonly type: TowerType;
  readonly col: number;
  readonly row: number;
  readonly size: number;
  readonly rotation: number;
  readonly level: number;
  readonly heat: number;
  readonly redline: number;
  readonly heatMult: number;
  readonly damage: number;
  readonly slowFactor: number;
  readonly output: number;
  readonly tripped: boolean;
  readonly tripTimer: number;
  readonly firing: boolean;
  readonly targeting: number | null;
  readonly radiatorFaces: readonly Face[];
  readonly kills: number;
  readonly damageDealt: number;
  readonly spent: number;
  readonly refund: number;
  readonly upgradeCost: number;
  readonly fresh: boolean;
  readonly firingEnabled: boolean;
  readonly thermalEnabled: boolean;
}

/** One surge unit, as the snapshot reports it. */
export interface UnitReport {
  readonly id: number;
  readonly type: SurgeType;
  readonly x: number;
  readonly y: number;
  readonly col: number;
  readonly row: number;
  readonly hp: number;
  readonly maxHp: number;
  readonly speed: number;
  readonly baseSpeed: number;
  readonly slowed: boolean;
  readonly slowFactor: number;
  readonly slowTimer: number;
  readonly flying: boolean;
  readonly vent: VentName;
  readonly exhaust: ExhaustName;
  readonly remaining: number;
  readonly motion: boolean;
}

/** The held build preview, as the snapshot reports it. */
export interface BuildReport {
  readonly type: TowerType;
  readonly col: number;
  readonly row: number;
  readonly rotation: number;
  readonly valid: boolean;
}

/** One row of the current screen's menu, as its hit rectangle. */
export interface MenuRowReport {
  readonly index: number;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** The whole snapshot. */
export interface MeltdownSnapshot {
  readonly version: number;
  readonly screen: Screen;
  readonly phase: Phase;
  readonly menuIndex: number;
  readonly mode: ModeName;
  readonly difficulty: DifficultyName;
  readonly money: number;
  readonly lives: number;
  readonly score: number;
  readonly wave: number;
  readonly waveCount: number;
  readonly startMoney: number;
  readonly startLives: number;
  readonly interest: boolean;
  readonly buildTimer: number;
  readonly wavePending: number;
  readonly waveRemaining: number;
  readonly nextWave: {
    readonly type: SurgeType;
    readonly count: number;
  } | null;
  readonly speed: number;
  readonly muted: boolean;
  readonly waveSpawning: boolean;
  readonly pointer: {
    readonly x: number;
    readonly y: number;
    readonly down: boolean;
  };
  readonly selected: number | null;
  readonly hoverShop: TowerType | null;
  readonly build: BuildReport | null;
  readonly buildZone: {
    readonly col0: number;
    readonly row0: number;
    readonly col1: number;
    readonly row1: number;
  } | null;
  readonly paths: {
    readonly left: { readonly length: number };
    readonly top: { readonly length: number };
  };
  readonly menu: readonly MenuRowReport[];
  readonly controls: Controls;
  readonly towers: readonly TowerReport[];
  readonly surge: readonly UnitReport[];
  readonly simTime: number;
}

/** The wave the panel is previewing, or `null` where there is no coming wave. */
function nextWaveOf(
  state: MeltdownState,
): { type: SurgeType; count: number } | null {
  const count = waveCountOf(state.mode, state.difficulty);
  const coming = state.phase === "wave" ? state.wave + 1 : state.wave;
  if (coming > count) return null;
  return {
    type: waveTypeOf(state.mode, coming, count),
    count: waveSizeOf(state.mode, coming, count),
  };
}

/** A pure read of the state, exactly as specs/instrumentation.md shapes it. */
export function snapshotOf(state: MeltdownState): MeltdownSnapshot {
  const routes = routesOf(state.towers);
  const waveCount = waveCountOf(state.mode, state.difficulty);
  return {
    version: MELTDOWN_DEBUG_VERSION,
    screen: state.screen,
    phase: state.phase,
    menuIndex: state.menuIndex,
    mode: state.mode,
    difficulty: state.difficulty,
    money: state.money,
    lives: state.lives,
    score: state.score,
    wave: state.wave,
    waveCount,
    startMoney: startMoneyOf(state.mode, state.difficulty),
    startLives: startLivesOf(state.mode),
    interest: interestOf(state.mode),
    buildTimer: state.buildTimer,
    wavePending: state.wavePending,
    waveRemaining:
      state.phase === "wave"
        ? state.wavePending + state.surge.length
        : state.wavePending,
    nextWave: nextWaveOf(state),
    speed: state.speed,
    muted: state.muted,
    waveSpawning: state.waveSpawning,
    pointer: {
      x: state.pointer.x,
      y: state.pointer.y,
      down: state.pointer.down,
    },
    selected: state.selected,
    hoverShop: state.hoverShop,
    build: state.build
      ? {
          type: state.build.type,
          col: state.build.col,
          row: state.build.row,
          rotation: state.build.rotation,
          valid: heldValid(state),
        }
      : null,
    buildZone: buildZoneOf(state.mode),
    paths: {
      left: { length: routes.leftLength },
      top: { length: routes.topLength },
    },
    menu: menuRects(state).map((rect, index) => ({ index, ...rect })),
    controls: controlsOf(state),
    towers: state.towers.map((tower) => ({
      id: tower.id,
      type: tower.type,
      col: tower.col,
      row: tower.row,
      size: sizeOf(tower.type),
      rotation: tower.rotation,
      level: tower.level,
      heat: tower.heat,
      redline: redlineOf(tower.type),
      heatMult: heatMultOf(tower),
      damage: damageOf(tower),
      slowFactor: slowFactorOf(tower),
      output: outputOf(tower),
      tripped: tower.tripped,
      tripTimer: tower.tripTimer,
      firing: tower.firing,
      targeting: tower.targeting,
      radiatorFaces:
        TOWER_DEFS[tower.type].kind === "mover"
          ? []
          : worldRadiators(tower.type, tower.rotation),
      kills: tower.kills,
      damageDealt: tower.damageDealt,
      spent: tower.spent,
      refund: refundOf(tower),
      upgradeCost: upgradeCostOf(tower),
      fresh: tower.fresh,
      firingEnabled: tower.firingEnabled,
      thermalEnabled: tower.thermalEnabled,
    })),
    surge: state.surge.map((unit) => {
      const tile = tileAt(unit.x, unit.y);
      return {
        id: unit.id,
        type: unit.type,
        x: unit.x,
        y: unit.y,
        col: tile.col,
        row: tile.row,
        hp: unit.hp,
        maxHp: unit.maxHp,
        speed: speedOf(unit),
        baseSpeed: baseSpeedOf(unit.type),
        slowed: unit.slowFactor > 0,
        slowFactor: unit.slowFactor,
        slowTimer: unit.slowTimer,
        flying: flying(unit.type),
        vent: unit.vent,
        exhaust: exhaustOf(unit.vent),
        remaining: remainingOf(unit, routes),
        motion: unit.motion,
      };
    }),
    simTime: state.simTime,
  };
}
