// Hollowdeep — the grid container, tile accessors, and the camera (specs/world.md).
//
// This is the plumbing every simulation system reads: index math, bounds/neighbor
// queries, and the CAMERA transform that maps world-pixel coordinates into the colony
// view (y in [64, 656]). It owns no sim logic — gas, power, pathfinding, jobs, economy,
// and the delvers all read the World this file shapes. The world-pixel -> screen
// convention here matches src/particles.ts exactly so overlays, sprites, and input all
// agree on where a tile is on screen.

import type { Camera, Tile, TileKind, World } from "./types";
import {
  TILE,
  VIEW_H,
  VIEW_W,
  VIEW_X0,
  VIEW_Y0,
  WORLD_PX_H,
  WORLD_PX_W,
} from "./constants";

// Flat index of a tile in a `w`-wide grid: index = ty*w + tx.
export function idx(w: number, tx: number, ty: number): number {
  return ty * w + tx;
}

export function inBounds(world: World, tx: number, ty: number): boolean {
  return tx >= 0 && ty >= 0 && tx < world.w && ty < world.h;
}

// The tile at (tx, ty), or null out of bounds.
export function tileAt(world: World, tx: number, ty: number): Tile | null {
  if (!inBounds(world, tx, ty)) return null;
  return world.tiles[idx(world.w, tx, ty)] ?? null;
}

export function kindAt(world: World, tx: number, ty: number): TileKind | null {
  const t = tileAt(world, tx, ty);
  return t ? t.kind : null;
}

// The in-bounds 4-connected neighbors (up, down, left, right) of a tile.
export function neighbors4(world: World, tx: number, ty: number): { tx: number; ty: number }[] {
  const out: { tx: number; ty: number }[] = [];
  if (tx > 0) out.push({ tx: tx - 1, ty });
  if (tx < world.w - 1) out.push({ tx: tx + 1, ty });
  if (ty > 0) out.push({ tx, ty: ty - 1 });
  if (ty < world.h - 1) out.push({ tx, ty: ty + 1 });
  return out;
}

// A fresh tile with the default (empty) fields; worldgen overrides `kind`/gas/`oreRich`.
export function makeTile(kind: TileKind): Tile {
  return {
    kind,
    oxygen: 0,
    co2: 0,
    designated: false,
    ghost: null,
    ghostPaid: false,
    machineId: -1,
    oreRich: 0,
  };
}

// ---- The camera ------------------------------------------------------------------
// `camera` is a world-pixel top-left plus a zoom. The colony view shows the world
// region [camera.x, camera.x + VIEW_W/zoom) x [camera.y, camera.y + VIEW_H/zoom),
// scaled to the view rectangle. The camera is clamped so it never scrolls past the
// sealed world border into empty space.

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function clampCamera(world: World): void {
  const cam = world.camera;
  const spanW = VIEW_W / cam.zoom;
  const spanH = VIEW_H / cam.zoom;
  cam.x = clamp(cam.x, 0, Math.max(0, WORLD_PX_W - spanW));
  cam.y = clamp(cam.y, 0, Math.max(0, WORLD_PX_H - spanH));
}

// Center the camera on a tile (its center), then clamp to the world bounds.
export function centerCameraOn(world: World, tx: number, ty: number): void {
  const cam = world.camera;
  cam.x = (tx + 0.5) * TILE - VIEW_W / cam.zoom / 2;
  cam.y = (ty + 0.5) * TILE - VIEW_H / cam.zoom / 2;
  clampCamera(world);
}

// World-pixel -> screen (matches src/particles.ts). Screen coords live inside the colony
// view rectangle, offset by VIEW_X0/VIEW_Y0 and scaled by the camera zoom.
export function worldToScreen(cam: Camera, wx: number, wy: number): { x: number; y: number } {
  return { x: VIEW_X0 + (wx - cam.x) * cam.zoom, y: VIEW_Y0 + (wy - cam.y) * cam.zoom };
}

// Screen -> tile coordinates (inverse of worldToScreen, floored to the tile grid).
export function screenToTile(cam: Camera, sx: number, sy: number): { tx: number; ty: number } {
  const wx = (sx - VIEW_X0) / cam.zoom + cam.x;
  const wy = (sy - VIEW_Y0) / cam.zoom + cam.y;
  return { tx: Math.floor(wx / TILE), ty: Math.floor(wy / TILE) };
}

// Screen -> world-pixel (for the free-floating hover cursor / drag rectangle).
export function screenToWorld(cam: Camera, sx: number, sy: number): { x: number; y: number } {
  return { x: (sx - VIEW_X0) / cam.zoom + cam.x, y: (sy - VIEW_Y0) / cam.zoom + cam.y };
}
