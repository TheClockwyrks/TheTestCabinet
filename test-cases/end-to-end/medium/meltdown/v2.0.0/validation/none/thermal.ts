// Meltdown — the heat model as pure arithmetic. CASE-PROVIDED.
//
// WHY THIS EXISTS. Every thermal check asserts a NUMBER: how much heat one frame
// of air cooling removes from a 2x2 Arc with three faces open, what a Sink on
// one face drains at heat 70, where two touching emitters settle. Those numbers
// are not free choices — `specs/heat.md` states the two-phase rule and the four
// flow constants, and the arithmetic below is that rule written out. So a check
// asserts an expectation computed from `RAD_K`, `BASE_K`, `COND_K`, `FORGE_K`
// and the tower table, rather than from a number a reference implementation
// happened to produce.
//
// NOTHING HERE READS THE BUILD'S OWN ANSWER. A tower's footprint SIZE and its
// radiator faces come from `specs/towers.md` through `constants.ts`, never from
// the `size` and `radiatorFaces` a snapshot reports — a build that reports a
// 3x3 Arc would otherwise be graded against its own mistake. What is taken from
// a snapshot is only what the CHECK ITSELF POSED: which type sits where, at what
// rotation, level and heat. `towerFrom` is that reading, and it is the one door
// in.
//
// AND NOTHING HERE IS A TOLERANCE. This says what the specification requires;
// how close a build must come to it is the check's own figure, stated in the
// check beside the flow it is measuring.

import {
  BASE_K,
  COND_K,
  FORGE_K,
  RAD_K,
  TOWER_DEFS,
  TRIP_HEAT,
  TRIP_TIME,
  emitterStats,
  inBounds,
  isEmitter,
  moverOutput,
  worldRadiators,
  type Side,
  type TowerType,
} from "./constants";
import type { TowerView } from "./harness";

/**
 * One tower as the heat model sees it.
 *
 * Everything the flows are computed FROM: where it sits, what it is, how hot it
 * is, and whether it takes part at all. Its footprint size and radiator faces
 * are not here because they are not free: they follow from `type` and
 * `rotation` through the specification's own table.
 */
export interface ThermalTower {
  id: number;
  type: TowerType;
  /** The footprint's top-left tile. */
  col: number;
  row: number;
  rotation: number;
  level: number;
  heat: number;
  tripped: boolean;
  /** The thermal gate. Off, the tower takes part in no term of the frame. */
  thermalEnabled: boolean;
}

/**
 * A snapshot's tower as the heat model sees it.
 *
 * The fields taken are the ones a check posed. `size` and `radiatorFaces` are
 * deliberately dropped on the way through: see the note at the head of the file.
 */
export function towerFrom(tower: TowerView): ThermalTower {
  return {
    id: tower.id,
    type: tower.type,
    col: tower.col,
    row: tower.row,
    rotation: tower.rotation,
    level: tower.level,
    heat: tower.heat,
    tripped: tower.tripped,
    thermalEnabled: tower.thermalEnabled,
  };
}

/** The footprint side `specs/towers.md` gives this type, in tiles. */
export function sizeOf(type: TowerType): number {
  return TOWER_DEFS[type].size;
}

/** One perimeter edge-tile: the world face it lies on, and the tile outside it. */
export interface PerimeterEdge {
  side: Side;
  /** The tile immediately outside. May be off the grid — that is the casing. */
  col: number;
  row: number;
}

/**
 * Every perimeter edge-tile of a footprint, one per tile of each of its four
 * faces (`specs/heat.md`).
 */
export function perimeterEdges(
  col: number,
  row: number,
  size: number,
): PerimeterEdge[] {
  const edges: PerimeterEdge[] = [];
  for (let k = 0; k < size; k += 1) {
    edges.push({ side: "N", col: col + k, row: row - 1 });
    edges.push({ side: "S", col: col + k, row: row + size });
    edges.push({ side: "W", col: col - 1, row: row + k });
    edges.push({ side: "E", col: col + size, row: row + k });
  }
  return edges;
}

/** How a tower's edge-tiles are spent: on air, or on the towers it abuts. */
export interface EdgeAccount {
  /** Edge-tiles facing air on this tower's radiator faces. */
  radiatorEdges: number;
  /** Edge-tiles facing air on its other faces. */
  plainEdges: number;
  /** Edge-tiles shared with each abutting tower, by that tower's id. */
  shared: Map<number, number>;
}

/** The id of the tower covering a tile, or `null` when nothing does. */
function ownerAt(
  towers: readonly ThermalTower[],
  col: number,
  row: number,
): number | null {
  for (const tower of towers) {
    const size = sizeOf(tower.type);
    if (
      col >= tower.col &&
      col < tower.col + size &&
      row >= tower.row &&
      row < tower.row + size
    ) {
      return tower.id;
    }
  }
  return null;
}

/**
 * Classify every perimeter edge-tile of `tower` by what lies outside it: open
 * floor, an opening, or the casing sheds to air; another tower conducts or
 * exchanges instead, and sheds nothing (`specs/heat.md`).
 */
export function accountEdges(
  tower: ThermalTower,
  towers: readonly ThermalTower[],
): EdgeAccount {
  const radiators = new Set(worldRadiators(tower.type, tower.rotation));
  const account: EdgeAccount = {
    radiatorEdges: 0,
    plainEdges: 0,
    shared: new Map(),
  };
  for (const edge of perimeterEdges(tower.col, tower.row, sizeOf(tower.type))) {
    const outside = inBounds(edge.col, edge.row)
      ? ownerAt(towers, edge.col, edge.row)
      : null;
    if (outside !== null && outside !== tower.id) {
      account.shared.set(outside, (account.shared.get(outside) ?? 0) + 1);
      continue;
    }
    if (radiators.has(edge.side)) account.radiatorEdges += 1;
    else account.plainEdges += 1;
  }
  return account;
}

/** How many edge-tiles two towers abut along; a corner touch is none. */
export function sharedEdges(a: ThermalTower, b: ThermalTower): number {
  return accountEdges(a, [a, b]).shared.get(b.id) ?? 0;
}

/** Whether a tower takes part in this frame's resolution at all. */
function participates(tower: ThermalTower): boolean {
  return tower.thermalEnabled && !tower.tripped;
}

/** The four flows and the shot gain, each as `specs/heat.md` writes it. */
export interface HeatTerms {
  airLoss: number;
  conduct: number;
  forgeGain: number;
  sinkLoss: number;
  shotGain: number;
  /** The whole change this frame, mass already divided in. */
  delta: number;
}

/**
 * The terms of one frame of duration `dt` for `tower`, every one computed from
 * the heats the frame OPENED with.
 *
 * `shots` is how many shots each tower resolved during this frame, which
 * `specs/combat.md` fixes; leave it out for the idle towers a thermal scenario
 * poses. Movers and towers taking no part answer all zeroes.
 */
export function heatTerms(
  tower: ThermalTower,
  towers: readonly ThermalTower[],
  dt: number,
  shots: ReadonlyMap<number, number> = new Map(),
): HeatTerms {
  const zero: HeatTerms = {
    airLoss: 0,
    conduct: 0,
    forgeGain: 0,
    sinkLoss: 0,
    shotGain: 0,
    delta: 0,
  };
  const def = TOWER_DEFS[tower.type];
  if (!isEmitter(def) || !participates(tower)) return zero;

  const heat = tower.heat;
  const account = accountEdges(tower, towers);
  const airLoss =
    (RAD_K * account.radiatorEdges + BASE_K * account.plainEdges) *
    (heat / TRIP_HEAT);

  let conduct = 0;
  let forgeGain = 0;
  let sinkLoss = 0;
  for (const [id, edges] of account.shared) {
    const other = towers.find((candidate) => candidate.id === id);
    if (other === undefined || !participates(other)) continue;
    const otherDef = TOWER_DEFS[other.type];
    if (isEmitter(otherDef)) {
      conduct += COND_K * edges * (other.heat - heat);
    } else if (other.type === "forge") {
      forgeGain +=
        FORGE_K *
        edges *
        Math.max(0, moverOutput(otherDef, other.level) - heat);
    } else {
      sinkLoss +=
        moverOutput(otherDef, other.level) * edges * (heat / TRIP_HEAT);
    }
  }

  const shotGain =
    (shots.get(tower.id) ?? 0) * emitterStats(def, tower.level).heatPerShot;

  return {
    airLoss,
    conduct,
    forgeGain,
    sinkLoss,
    shotGain,
    delta:
      (shotGain + (conduct + forgeGain - airLoss - sinkLoss) * dt) / def.mass,
  };
}

/** The change one frame of duration `dt` makes to `tower`'s heat. */
export function heatDelta(
  tower: ThermalTower,
  towers: readonly ThermalTower[],
  dt: number,
  shots: ReadonlyMap<number, number> = new Map(),
): number {
  return heatTerms(tower, towers, dt, shots).delta;
}

/** A tower after one frame: its heat, whether it is tripped, and its cooldown. */
export interface ThermalStep {
  heat: number;
  tripped: boolean;
  tripTimer: number;
  /** Whether this frame is the one the tower CROSSED into a trip on. */
  trips: boolean;
}

/**
 * Resolve one frame of duration `dt` over the whole floor, in the two phases
 * `specs/heat.md` states: every change from the heats the frame opened with,
 * then every new heat written.
 *
 * A tripped tower takes part in no term: it bleeds at `TRIP_HEAT / TRIP_TIME`
 * per second, its cooldown counts down, and it comes back online at heat `0`.
 * THE TRIP IS A CROSSING: a tower trips on the frame in which its newly written
 * heat reaches `100` having opened that frame below it, so a tower posed at
 * `100` — which opens the frame cooling, since air cooling is maximal there —
 * does not trip.
 */
export function resolveFrame(
  towers: readonly ThermalTower[],
  dt: number,
  shots: ReadonlyMap<number, number> = new Map(),
  tripTimers: ReadonlyMap<number, number> = new Map(),
): Map<number, ThermalStep> {
  const deltas = new Map<number, number>();
  for (const tower of towers) {
    deltas.set(tower.id, heatDelta(tower, towers, dt, shots));
  }

  const next = new Map<number, ThermalStep>();
  for (const tower of towers) {
    const timer = tripTimers.get(tower.id) ?? 0;
    if (tower.tripped) {
      if (!tower.thermalEnabled) {
        next.set(tower.id, {
          heat: tower.heat,
          tripped: true,
          tripTimer: timer,
          trips: false,
        });
        continue;
      }
      const bled = Math.max(0, tower.heat - (TRIP_HEAT / TRIP_TIME) * dt);
      const left = timer - dt;
      next.set(
        tower.id,
        left <= 0
          ? { heat: 0, tripped: false, tripTimer: 0, trips: false }
          : { heat: bled, tripped: true, tripTimer: left, trips: false },
      );
      continue;
    }
    const before = tower.heat;
    const after = Math.min(
      TRIP_HEAT,
      Math.max(0, before + (deltas.get(tower.id) ?? 0)),
    );
    const trips = before < TRIP_HEAT && after >= TRIP_HEAT;
    next.set(tower.id, {
      heat: after,
      tripped: trips,
      tripTimer: trips ? TRIP_TIME : timer,
      trips,
    });
  }
  return next;
}

/**
 * The heat one tower reaches after `frames` frames of `dt`, resolved over the
 * whole floor each frame.
 *
 * The form most thermal checks want: pose a floor, drive the same span through
 * the build, and compare the two.
 */
export function heatAfter(
  towers: readonly ThermalTower[],
  id: number,
  dt: number,
  frames: number,
  shots: ReadonlyMap<number, number> = new Map(),
): number {
  let live = towers.map((tower) => ({ ...tower }));
  const timers = new Map<number, number>();
  for (let i = 0; i < frames; i += 1) {
    const stepped = resolveFrame(live, dt, shots, timers);
    live = live.map((tower) => {
      const step = stepped.get(tower.id);
      if (step === undefined) return tower;
      timers.set(tower.id, step.tripTimer);
      return { ...tower, heat: step.heat, tripped: step.tripped };
    });
  }
  return live.find((tower) => tower.id === id)?.heat ?? Number.NaN;
}
