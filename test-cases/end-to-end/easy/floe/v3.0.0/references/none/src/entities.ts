// Floe — the bodies on the strait, and what each is standing on.
//
// The critter and the bears are made here and read here; how they MOVE is in
// `src/game.ts` (the hop) and `src/hunter.ts` (the glide). What is in this file
// is everything both of those and the debug surface need in the same words: how a
// body is placed on a tile, what its footing is, and what a fresh one looks like.

import {
  ROW_NEAR,
  START_COL,
  TILE,
  bearIceSpeed,
  bearSwimSpeed,
  colAt,
  rowAt,
  tileCX,
  tileCY,
} from "./constants";
import { isWaterRow } from "./grid";
import { floeAtPoint } from "./lanes";
import type { Bear, Critter, FloeState, Facing, Footing } from "./types";

/** A critter settled on a tile, facing up, ready to hop (specs/instrumentation.md). */
export function makeCritter(col: number, row: number): Critter {
  const x = tileCX(col);
  const y = tileCY(row);
  return {
    present: true,
    x,
    y,
    prevX: x,
    prevY: y,
    facing: "up",
    hopCooldown: 0,
    bestRow: row,
  };
}

/** The pose a fresh crossing begins from (specs/progression.md). */
export function freshCritter(): Critter {
  return makeCritter(START_COL, ROW_NEAR);
}

/** The tile the critter is on, which follows its center. */
export function critterCol(critter: Critter): number {
  return colAt(critter.x);
}

/** The row the critter is on, which follows its center. */
export function critterRow(critter: Critter): number {
  return rowAt(critter.y);
}

/** Put a body's center somewhere, leaving no interpolation trail behind it. */
export function placeCenter(
  body: { x: number; y: number; prevX: number; prevY: number },
  x: number,
  y: number,
): void {
  body.x = x;
  body.y = y;
  body.prevX = x;
  body.prevY = y;
}

/**
 * What a body standing at `x` on `row` is on (specs/strait.md).
 *
 * Read for the critter, and read again for the tile a bear is travelling into,
 * because a bear's speed depends on the same three-way answer.
 */
export function footingAt(state: FloeState, x: number, row: number): Footing {
  if (!isWaterRow(row)) return "solid";
  return floeAtPoint(state, x, row) === null ? "water" : "floe";
}

/** The critter's footing. */
export function critterFooting(state: FloeState): Footing {
  return footingAt(state, state.critter.x, critterRow(state.critter));
}

/** A bear settled on a tile, hunting its own tile, every faculty on. */
export function makeBear(state: FloeState, col: number, row: number): Bear {
  const x = tileCX(col);
  const y = tileCY(row);
  return {
    id: state.nextId++,
    col,
    row,
    stepCol: col,
    stepRow: row,
    x,
    y,
    prevX: x,
    prevY: y,
    facing: "up",
    target: { col, row },
    sense: true,
    routing: true,
    travel: true,
    carry: 0,
    lunge: 0,
  };
}

/** Whether a bear is settled on its tile rather than travelling between two. */
export function isSettled(bear: Bear): boolean {
  return bear.stepCol === bear.col && bear.stepRow === bear.row;
}

/**
 * Whether a bear is over open water: the tile it is travelling into is a
 * water-band tile no floe covers (specs/hunter.md). A settled bear reads its own.
 */
export function bearSwimming(state: FloeState, bear: Bear): boolean {
  return footingAt(state, tileCX(bear.stepCol), bear.stepRow) === "water";
}

/** A bear's speed, in stage units per second: its footing and the level decide it. */
export function bearSpeed(state: FloeState, bear: Bear): number {
  const tiles = bearSwimming(state, bear)
    ? bearSwimSpeed(state.level)
    : bearIceSpeed(state.level);
  return tiles * TILE;
}

/** The bear with that id, or `null`. */
export function bearById(state: FloeState, id: number): Bear | null {
  return state.bears.find((bear) => bear.id === id) ?? null;
}

/**
 * Take a bear off the strait, and empty the slot it filled.
 *
 * Every removal runs through here — traffic, a death, a completed crossing, and
 * the debug surface alike — so a slot can never be left holding a bear that is
 * no longer on the roster.
 */
export function dropBear(state: FloeState, id: number): void {
  state.bears = state.bears.filter((bear) => bear.id !== id);
  for (const slot of state.slots) {
    if (slot.bearId === id) {
      slot.bearId = null;
      slot.emptyFor = 0;
    }
  }
}

/** Take every bear off the strait and empty every slot. */
export function dropAllBears(state: FloeState): void {
  state.bears = [];
  for (const slot of state.slots) {
    slot.bearId = null;
    slot.emptyFor = 0;
  }
}

/** The facing that steps from one tile to a neighboring one. */
export function facingBetween(
  fromCol: number,
  fromRow: number,
  toCol: number,
  toRow: number,
): Facing {
  if (toRow < fromRow) return "up";
  if (toRow > fromRow) return "down";
  if (toCol < fromCol) return "left";
  return "right";
}
