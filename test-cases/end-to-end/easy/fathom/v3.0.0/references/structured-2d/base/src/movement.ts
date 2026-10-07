// Fathom — how a body travels the maze.
//
// The forager, the predators and the drifters all move the same way
// (`specs/movement.md`): along the center lines of the corridors, always in one
// of the four cardinal directions or at rest, sliding continuously between tile
// centers. A center is the only place a body turns onto a perpendicular
// direction; a reversal is taken wherever it stands. The wrap tunnel is one
// ordinary step, so a body crossing it carries its position across rather than
// stopping at the border.

import { TILE } from "./constants";
import type { Cell, Dir } from "./grid";
import {
  MAZE_LEFT,
  MAZE_WIDTH,
  cellAt,
  opposite,
  rowAt,
  tileCenterX,
  tileCenterY,
} from "./grid";
import type { Maze, TileTest } from "./maze";

/** Everything that travels the maze. */
export interface Body {
  x: number;
  y: number;
  /** The direction it is travelling, or `null` while it is at rest. */
  heading: Dir | null;
  /** The direction it faces, which it keeps while at rest. */
  facing: Dir;
  /** Its current pace, in logical units per second. */
  speed: number;
}

/** The direction a body wants next, asked fresh at each decision point. */
export type Intent = () => Dir | null;

const EPSILON = 0.001;

/** The tile whose bounds contain the body's center. */
export function bodyCell(body: Body): Cell {
  return cellAt(body.x, body.y);
}

/** Whether the body stands on the center of its tile. */
export function atTileCenter(body: Body): boolean {
  const cell = bodyCell(body);
  return (
    Math.abs(body.x - tileCenterX(cell.tx)) < 0.5 &&
    Math.abs(body.y - tileCenterY(cell.ty)) < 0.5
  );
}

/** Puts a body at rest on the center of a tile. */
export function restAt(body: Body, cell: Cell): void {
  body.x = tileCenterX(cell.tx);
  body.y = tileCenterY(cell.ty);
  body.heading = null;
}

function shift(body: Body, dir: Dir, distance: number, maze: Maze): void {
  if (dir === "up") body.y -= distance;
  else if (dir === "down") body.y += distance;
  else if (dir === "left") body.x -= distance;
  else body.x += distance;

  // The wrap tunnel: the crossing covers the same ground as any step between
  // neighbors, so the body is left as far past the far border as it had gone
  // past the near one and its center stays inside the maze region.
  if (rowAt(body.y) !== maze.wrapRow) return;
  if (body.x < MAZE_LEFT) body.x += MAZE_WIDTH;
  else if (body.x >= MAZE_LEFT + MAZE_WIDTH) body.x -= MAZE_WIDTH;
}

/** How far ahead the next tile center lies along the body's heading. */
function toNextCenter(body: Body, heading: Dir): number {
  const cell = bodyCell(body);
  const cx = tileCenterX(cell.tx);
  const cy = tileCenterY(cell.ty);
  switch (heading) {
    case "right":
      return body.x < cx - EPSILON ? cx - body.x : cx + TILE - body.x;
    case "left":
      return body.x > cx + EPSILON ? body.x - cx : body.x - (cx - TILE);
    case "down":
      return body.y < cy - EPSILON ? cy - body.y : cy + TILE - body.y;
    default:
      return body.y > cy + EPSILON ? body.y - cy : body.y - (cy - TILE);
  }
}

function snapToCenter(body: Body): void {
  const cell = bodyCell(body);
  body.x = tileCenterX(cell.tx);
  body.y = tileCenterY(cell.ty);
}

/** Whether the tile one step in `dir` is open to this body. */
function canGo(body: Body, maze: Maze, dir: Dir, open: TileTest): boolean {
  const cell = bodyCell(body);
  const next = maze.step(cell.tx, cell.ty, dir);
  return open(next.tx, next.ty);
}

/**
 * Whether the body's center already lies on the center line travel in `dir`
 * runs along. A body only ever moves along one axis at a time, so this is true
 * of the axis it is on and true of the other only at a tile center — which is
 * what keeps every body on the corridor center lines.
 */
function alignedFor(body: Body, dir: Dir): boolean {
  const cell = bodyCell(body);
  return dir === "left" || dir === "right"
    ? Math.abs(body.y - tileCenterY(cell.ty)) < 0.5
    : Math.abs(body.x - tileCenterX(cell.tx)) < 0.5;
}

/** The way back to the center of the tile the body stands on. */
function towardOwnCenter(body: Body, dir: Dir): Dir {
  const cell = bodyCell(body);
  if (dir === "left" || dir === "right") {
    return body.y > tileCenterY(cell.ty) ? "up" : "down";
  }
  return body.x > tileCenterX(cell.tx) ? "left" : "right";
}

/**
 * At a tile center: take the wanted direction where the tile that way is open,
 * otherwise carry on along the current heading while the tile ahead is open,
 * and come to rest at the center when it is closed. Nothing wanted at all is
 * rest, because a body travels only while something asks it to.
 */
function decide(
  body: Body,
  maze: Maze,
  wanted: Dir | null,
  open: TileTest,
): void {
  if (wanted === null) {
    body.heading = null;
    return;
  }
  if (canGo(body, maze, wanted, open)) {
    body.heading = wanted;
    return;
  }
  if (body.heading !== null && canGo(body, maze, body.heading, open)) return;
  body.heading = null;
}

/**
 * Advances a body by `dt`. `intent` is asked at every decision point, so a
 * wander re-picks exactly at junctions and a chase re-reads its route from each
 * tile it reaches.
 */
export function advanceBody(
  body: Body,
  dt: number,
  maze: Maze,
  intent: Intent,
  open: TileTest,
): void {
  // A body the layout has closed over holds the tile it stands on: travel
  // carries a body only along tiles open to it, so there is no step out of a
  // tile that is not one (`specs/movement.md`, `specs/instrumentation.md`).
  const standing = bodyCell(body);
  if (!open(standing.tx, standing.ty)) {
    body.heading = null;
    return;
  }

  const wanted = intent();

  if (wanted === null) {
    // Nothing is asking it to travel, so it comes to rest where it stands.
    body.heading = null;
    return;
  }

  // A reversal is honored at once, wherever the body stands.
  if (body.heading !== null && wanted === opposite(body.heading)) {
    body.heading = wanted;
  }

  if (body.heading === null) {
    if (!canGo(body, maze, wanted, open)) return;
    // A body at rest between two centers cannot turn across the corridor
    // without leaving its center line, so it runs the short way back to the
    // center of its own tile and takes the turn there, where turns are taken.
    body.heading = alignedFor(body, wanted)
      ? wanted
      : towardOwnCenter(body, wanted);
  }

  let remaining = body.speed * dt;
  // The guard bounds a step that somehow keeps landing on centers; a tick at
  // TICK_HZ never crosses more than one.
  for (let guard = 0; guard < 200; guard += 1) {
    const heading = body.heading;
    if (heading === null || remaining <= EPSILON) break;
    const gap = toNextCenter(body, heading);
    if (gap > remaining + EPSILON) {
      shift(body, heading, remaining, maze);
      break;
    }
    shift(body, heading, gap, maze);
    remaining -= gap;
    snapToCenter(body);
    decide(body, maze, intent(), open);
  }

  const heading = body.heading;
  if (heading !== null) body.facing = heading;
}
