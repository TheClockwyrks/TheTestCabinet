// Fathom — how a body travels the maze (`specs/movement.md`).
//
// The forager, the predators and the bonus drifters all move the same way: along
// the center lines of the corridors, in one of the four cardinal directions or at
// rest, sliding continuously between tile centers and changing direction only
// where the rules allow. This module is that arithmetic. It holds no state: a
// step takes a body and returns the next one.
//
// A body is a plain record — `ForagerState`, `PredatorState` and `DrifterState`
// each carry its fields — so a caller spreads the step's result back over
// whichever record it was moving.

import { GRID_COLS, GRID_ORIGIN_X, TILE } from "./constants";
import { DIRS, centerX, centerY, columnAt, opposite, rowAt } from "./grid";
import { foragerCanEnter, stepTile } from "./maze";
import type { Draws } from "./rng";
import type { Dir, Heading, MazeState, Tile } from "./state";

/** How close to a tile center counts as being on it. */
const CENTER_EPSILON = 0.001;

/** The part of a creature this module moves. */
export interface Body {
  readonly x: number;
  readonly y: number;
  readonly facing: Dir;
  readonly heading: Heading;
}

/** What one step of travel is given. */
export interface MoveRequest {
  readonly maze: MazeState;
  /** The body's speed, in logical units per second. */
  readonly speed: number;
  /** The length of the step, in seconds. */
  readonly dt: number;
  /** Which tiles this body may stand on. */
  readonly canEnter: (tx: number, ty: number) => boolean;
  /**
   * The direction wanted right now. A reversal of the current heading is taken at
   * once, wherever the body stands; every other direction waits for a tile center.
   */
  readonly request: Heading;
  /**
   * The direction to leave a tile center in, asked each time one is reached, so a
   * body that draws its own way picks at the junction rather than a step early.
   */
  readonly decide: (body: Body) => Heading;
}

/** The tile a body's center lies on. */
export function bodyTile(body: Body): Tile {
  return { tx: columnAt(body.x), ty: rowAt(body.y) };
}

/** Whether a body's center is on the center of the tile it stands on. */
export function atTileCenter(body: Body): boolean {
  return (
    Math.abs(body.x - centerX(columnAt(body.x))) < 0.5 &&
    Math.abs(body.y - centerY(rowAt(body.y))) < 0.5
  );
}

/** A body resting on the center of `(tx, ty)`, facing as it was. */
export function restAt(body: Body, tx: number, ty: number): Body {
  return { x: centerX(tx), y: centerY(ty), facing: body.facing, heading: null };
}

function moved(body: Body, dir: Dir, distance: number): Body {
  let { x, y } = body;
  switch (dir) {
    case "up":
      y -= distance;
      break;
    case "down":
      y += distance;
      break;
    case "left":
      x -= distance;
      break;
    case "right":
      x += distance;
      break;
  }
  return { ...body, x, y };
}

/**
 * The body with a crossing of the wrap tunnel applied.
 *
 * The tunnel is the one place a body leaves the maze region, and it arrives on
 * the far side as far past that border as it had gone past this one, so the
 * crossing covers the same ground as any other step and the center stays inside
 * the maze region (`specs/maze.md`). Only the pierced row lets a body reach the
 * border at all: every other row's border tile is rock, so `canEnter` stops it.
 */
function wrapped(body: Body): Body {
  const width = GRID_COLS * TILE;
  if (body.x < GRID_ORIGIN_X) return { ...body, x: body.x + width };
  if (body.x >= GRID_ORIGIN_X + width) return { ...body, x: body.x - width };
  return body;
}

/** The distance along the current heading to the next tile center ahead. */
function toNextCenter(body: Body): number {
  const cx = centerX(columnAt(body.x));
  const cy = centerY(rowAt(body.y));
  switch (body.heading) {
    case "right":
      return body.x < cx - CENTER_EPSILON ? cx - body.x : cx + TILE - body.x;
    case "left":
      return body.x > cx + CENTER_EPSILON ? body.x - cx : body.x - (cx - TILE);
    case "down":
      return body.y < cy - CENTER_EPSILON ? cy - body.y : cy + TILE - body.y;
    case "up":
      return body.y > cy + CENTER_EPSILON ? body.y - cy : body.y - (cy - TILE);
    default:
      return Infinity;
  }
}

function snapped(body: Body): Body {
  return { ...body, x: centerX(columnAt(body.x)), y: centerY(rowAt(body.y)) };
}

/**
 * The heading a body leaves the tile center it has reached in.
 *
 * It takes the direction it wants when the tile that way is open to it;
 * otherwise it carries on while the tile ahead is open, and comes to rest when
 * that tile is closed to it.
 */
function leaveCenter(body: Body, request: Heading, req: MoveRequest): Heading {
  if (request !== null) {
    const ahead = stepTile(req.maze, columnAt(body.x), rowAt(body.y), request);
    if (req.canEnter(ahead.tx, ahead.ty)) return request;
  }
  if (body.heading === null) return null;
  const straight = stepTile(
    req.maze,
    columnAt(body.x),
    rowAt(body.y),
    body.heading,
  );
  return req.canEnter(straight.tx, straight.ty) ? body.heading : null;
}

/**
 * The body after one step of travel.
 *
 * The step is walked center by center rather than in one jump, so a body that
 * reaches a junction inside the step decides there and spends what is left of the
 * step on the way it chose. A body standing on a tile closed to it travels
 * nowhere at all.
 */
export function moveBody(body: Body, req: MoveRequest): Body {
  let current = body;

  // Travel carries a body only along tiles open to it, so a body a posed layout
  // has left on a tile closed to it holds that tile and travels nowhere
  // (`specs/instrumentation.md`).
  const here = bodyTile(current);
  if (!req.canEnter(here.tx, here.ty)) return { ...current, heading: null };

  // A reversal is honored wherever the body stands, not only at a center.
  if (
    current.heading !== null &&
    req.request !== null &&
    req.request === opposite(current.heading)
  ) {
    current = { ...current, heading: req.request };
  }

  if (current.heading === null) {
    const wanted = req.request ?? req.decide(current);
    if (wanted === null) return current;
    const ahead = stepTile(
      req.maze,
      columnAt(current.x),
      rowAt(current.y),
      wanted,
    );
    if (!req.canEnter(ahead.tx, ahead.ty)) return current;
    current = { ...current, heading: wanted };
  }

  let remaining = req.speed * req.dt;
  // One step never spans two tiles at any speed this game uses, but the loop is
  // written to walk as many centers as the step reaches so the arithmetic does not
  // quietly depend on that.
  let guard = 0;
  while (
    remaining > CENTER_EPSILON &&
    current.heading !== null &&
    guard++ < 200
  ) {
    const gap = toNextCenter(current);
    if (gap <= remaining + CENTER_EPSILON) {
      current = wrapped(moved(current, current.heading, gap));
      remaining -= gap;
      current = snapped(current);
      current = {
        ...current,
        heading: leaveCenter(current, req.decide(current), req),
      };
    } else {
      current = wrapped(moved(current, current.heading, remaining));
      remaining = 0;
    }
  }

  return current.heading === null
    ? current
    : { ...current, facing: current.heading };
}

/**
 * The direction a wandering creature leaves a tile center in: one of the open
 * directions there, preferring one other than an immediate reverse
 * (`specs/gameplay.md`, `specs/predators.md`).
 */
export function wanderDirection(
  body: Body,
  maze: MazeState,
  canEnter: (tx: number, ty: number) => boolean,
  draws: Draws,
): Heading {
  const tile = bodyTile(body);
  const open: Dir[] = [];
  for (const dir of DIRS) {
    const n = stepTile(maze, tile.tx, tile.ty, dir);
    if (canEnter(n.tx, n.ty)) open.push(dir);
  }
  if (open.length === 0) return null;
  const back = body.heading === null ? null : opposite(body.heading);
  const forward = back === null ? open : open.filter((dir) => dir !== back);
  return draws.pick(forward.length > 0 ? forward : open);
}

/**
 * One step of a bonus drifter's travel: the corridor wander `specs/gameplay.md`
 * gives it, which a wandering Lanternjaw takes as well so the two amber lights
 * drift alike.
 */
export function driftBody(
  body: Body,
  maze: MazeState,
  speed: number,
  dt: number,
  draws: Draws,
): Body {
  const canEnter = (tx: number, ty: number): boolean =>
    foragerCanEnter(maze, tx, ty);
  return moveBody(body, {
    maze,
    speed,
    dt,
    canEnter,
    request: null,
    decide: (b) => wanderDirection(b, maze, canEnter, draws),
  });
}
