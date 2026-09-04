// Floe — the critter: its footing, its hop, and every rule that refuses one
// (`specs/hopping.md`, `specs/strait.md`, `specs/water.md`).
//
// The critter has exactly one movement of its own, the one-tile hop, and one
// movement done to it, the carry a floe gives it. Both are here, with the five
// refusals `specs/hopping.md` owns.
//
// AN ACCEPTED HOP IS ABSOLUTE. The target is the critter's own tile offset by one,
// and the hop puts its centre exactly on that tile's centre whatever the centre was
// before — so a critter carried half a tile along a floe hops to the centre of the
// column its centre was in, rather than being translated by a tile and left between
// columns.

import {
  HOP_COOLDOWN,
  ROW_BAYS,
  ROW_CAP,
  ROW_NEAR,
  START_COL,
  STRAIT_W,
  TILE,
  colAt,
  inBounds,
  rowAt,
  tileCX,
  tileCY,
} from "./constants";
import { laneMotion } from "./lanes";
import {
  STEPS,
  anyCoversBody,
  anyCoversTile,
  bayAt,
  isWaterRow,
} from "./strait";
import type { Direction } from "./strait";
import type { Sim } from "./sim";
import type { Footing } from "./game";

/** The tile the critter is on: its centre, through the map's own inverses. */
export function critterCol(sim: Sim): number {
  return colAt(sim.critter.x);
}

export function critterRow(sim: Sim): number {
  return rowAt(sim.critter.y);
}

/**
 * What the critter is standing on (`specs/strait.md`).
 *
 * Solid on the two shores, the median and the ice band; on a water row it is
 * `floe` while a floe of that row covers its centre and `water` otherwise.
 */
export function footingOf(sim: Sim): Footing {
  const row = critterRow(sim);
  if (!isWaterRow(row)) return "solid";
  return anyCoversBody(sim.floes, row, sim.critter.x) ? "floe" : "water";
}

/** Why a hop into `(col, row)` is refused, or `null` where it is accepted. */
export function hopRefusal(sim: Sim, col: number, row: number): string | null {
  if (!inBounds(col, row)) return "off the grid";
  if (row === ROW_CAP) return "the solid cap of the far shore";
  if (row === ROW_BAYS) {
    const bay = bayAt(col);
    if (bay === null) return "solid far shore";
    if (sim.bays[bay]) return "a filled bay";
  }
  if (anyCoversTile(sim.vehicles, col, row)) return "a vehicle";
  return null;
}

/** Put the critter's centre exactly on a tile's centre. */
export function settleCritter(sim: Sim, col: number, row: number): void {
  sim.critter.x = tileCX(col);
  sim.critter.y = tileCY(row);
}

/** The pose a fresh crossing begins from (`specs/progression.md`). */
export function placeFreshCritter(sim: Sim): void {
  sim.critter.present = true;
  sim.critter.facing = "up";
  sim.critter.hopCooldown = 0;
  sim.critter.bestRow = ROW_NEAR;
  settleCritter(sim, START_COL, ROW_NEAR);
}

/** What one accepted hop did, so the caller can score and test the bay row. */
export interface HopResult {
  readonly col: number;
  readonly row: number;
  /** The hop took the crossing to a row it had not reached before. */
  readonly newRow: boolean;
}

/**
 * Take one hop in `direction`, or refuse it (`specs/hopping.md`).
 *
 * A refused hop leaves everything as it was: the critter stays where it stands
 * with the same facing, the cooldown is untouched, no life is lost and nothing is
 * scored.
 */
export function hop(sim: Sim, direction: Direction): HopResult | null {
  const step = STEPS[direction];
  const col = critterCol(sim) + step.dc;
  const row = critterRow(sim) + step.dr;
  if (hopRefusal(sim, col, row) !== null) return null;

  const newRow = row < sim.critter.bestRow;
  settleCritter(sim, col, row);
  sim.critter.facing = direction;
  sim.critter.hopCooldown = HOP_COOLDOWN;
  if (newRow) sim.critter.bestRow = row;
  return { col, row, newRow };
}

/**
 * Carry the critter one tick along the lane under it (`specs/water.md`).
 *
 * A critter whose footing is `floe` drifts at that lane's own rate; its row and
 * its centre `y` are left where they are, and its column follows its centre.
 */
export function carryCritter(sim: Sim, dt: number): void {
  if (footingOf(sim) !== "floe") return;
  const { dir, speed } = laneMotion(sim, critterRow(sim));
  sim.critter.x += dir * speed * TILE * dt;
}

/** Whether the critter's centre has been carried off a side edge of the strait. */
export function sweptOff(sim: Sim): boolean {
  return sim.critter.x < 0 || sim.critter.x > STRAIT_W;
}
