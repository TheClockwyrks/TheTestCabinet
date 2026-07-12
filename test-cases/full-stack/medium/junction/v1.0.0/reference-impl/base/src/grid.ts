// Junction — tile-grid geometry helpers (view side).
//
// The simulation itself lives in the Rust/wasm core (`sim-core/`, specs/simulation.md);
// these are the pure index/geometry helpers the RENDERER and INPUT layer need to map
// between a tile (col,row) and its dense array index — no simulation state, just arithmetic
// over the fixed map dimensions. They mirror the same helpers in the Rust `world` module so
// the JS side reads the tile arrays (exposed as zero-copy views) at the right offsets.

import { MAP_COLS, MAP_ROWS } from "./constants";

export function idx(col: number, row: number): number {
  return row * MAP_COLS + col;
}
export function colOf(i: number): number {
  return i % MAP_COLS;
}
export function rowOf(i: number): number {
  return (i / MAP_COLS) | 0;
}
export function inBounds(col: number, row: number): boolean {
  return col >= 0 && col < MAP_COLS && row >= 0 && row < MAP_ROWS;
}
