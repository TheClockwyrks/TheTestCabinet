// Shared setup for this build's own tests. Not shipped: nothing under src imports it
// outside a `*.test.ts` file.

import { MINER_H, MINER_W, SURFACE_Y, TILE } from "./constants";
import { Game } from "./game";
import type { Ore, TileKind } from "./types";
import { colCenterX, setCell } from "./world";

/**
 * A game on an empty mine, in the mine, with the miner standing at the camp. Every
 * test that poses its own terrain starts here, so nothing a generated mine happens to
 * hold reaches the check.
 */
export function emptyGame(): Game {
  const game = new Game();
  game.reset();
  game.screen = "in-mine";
  game.clearMine();
  return game;
}

/** Set one cell to a kind, exactly as `setTile` on the debug surface does. */
export function setTile(
  game: Game,
  col: number,
  row: number,
  kind: TileKind,
): void {
  setCell(game.grid, col, row, kind, game.coreRow);
}

/** Set one cell to an ore vein holding `ore`. */
export function setOreTile(
  game: Game,
  col: number,
  row: number,
  ore: Ore,
): void {
  setCell(game.grid, col, row, "ore", game.coreRow).ore = ore;
}

/**
 * Stand the miner on top of the cell `(col, row)`, centered on its column. That cell
 * is the floor underfoot, and so the one a held down cut bites into.
 */
export function standOn(game: Game, col: number, row: number): void {
  game.miner.x = colCenterX(col, MINER_W);
  game.miner.y = row * TILE - MINER_H;
  game.miner.vx = 0;
  game.miner.vy = 0;
  game.miner.drilling = null;
}

/** Put the miner's box at a world position, at rest. */
export function placeAt(game: Game, x: number, y: number): void {
  game.miner.x = x;
  game.miner.y = y;
  game.miner.vx = 0;
  game.miner.vy = 0;
}

/** Run `seconds` of game time in `frames` whole frames. */
export function run(game: Game, seconds: number, frames: number): void {
  const step = seconds / frames;
  for (let i = 0; i < frames; i++) game.update(step);
}

/** Hold a set of actions for the frames that follow. */
export function hold(
  game: Game,
  input: Partial<{
    left: boolean;
    right: boolean;
    down: boolean;
    thrust: boolean;
  }>,
): void {
  game.input = {
    left: false,
    right: false,
    down: false,
    thrust: false,
    ...input,
  };
}

/** The world y a miner standing on top of `row` rests its box at. */
export function feetOn(row: number): number {
  return row * TILE - MINER_H;
}

/** The camp ground line, for a miner standing at the surface. */
export const CAMP_Y = SURFACE_Y - MINER_H;
