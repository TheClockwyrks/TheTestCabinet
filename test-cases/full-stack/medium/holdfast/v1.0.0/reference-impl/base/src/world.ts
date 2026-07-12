// Holdfast — the tile world: generation, tile accessors + derived flags, the camera
// transform, and the line-of-sight / cover helpers combat reads (DESIGN §4, specs/world.md,
// specs/combat.md). The analogue of valence's board.ts.
//
// The world is a bounded 60×44 grid of 24 px tiles (specs/world.md). Its outer ring is
// sealed rock; raiders instead enter at a handful of walkable EDGE SPAWN points cut into
// the border. The interior carries grass belts, rock outcrops, tree stands, and ore veins
// generated deterministically from MODE.mapSeed, with a cleared landing site at the center
// where the crew and the stockpile sit. The simulation reasons in tile coordinates and only
// renders in pixels; this module owns the tile↔pixel math and the world→screen transform.

import {
  BORDER,
  COLS,
  ROWS,
  STRUCTURES,
  TILE,
  VIEW_H,
  VIEW_W,
  VIEW_X0,
  VIEW_Y0,
  WORLD_H,
  WORLD_W,
} from "./constants";
import { RNG } from "./rng";
import type { PathNode, Structure, Tile } from "./types";

// ---- Tile ↔ pixel / index math -------------------------------------------------
export function idx(x: number, y: number): number {
  return y * COLS + x;
}
export function inBounds(x: number, y: number): boolean {
  return x >= 0 && x < COLS && y >= 0 && y < ROWS;
}
// The world-pixel center of a tile (settlers/raiders live at tile centers between moves).
export function tileCenterX(tx: number): number {
  return tx * TILE + TILE / 2;
}
export function tileCenterY(ty: number): number {
  return ty * TILE + TILE / 2;
}
export function tileOfPixelX(px: number): number {
  return Math.floor(px / TILE);
}
export function tileOfPixelY(py: number): number {
  return Math.floor(py / TILE);
}

// ---- Camera (pan / clamp / zoom, world→screen), used by input.ts and render.ts -
function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
// Keep the camera's top-left world point so the world border sits flush at a view edge and
// never scrolls past the sealed rim into empty space (specs/world.md).
export function clampCamera(camX: number, camY: number, zoom: number): { x: number; y: number } {
  const viewWorldW = VIEW_W / zoom;
  const viewWorldH = VIEW_H / zoom;
  const maxX = Math.max(0, WORLD_W - viewWorldW);
  const maxY = Math.max(0, WORLD_H - viewWorldH);
  return { x: clamp(camX, 0, maxX), y: clamp(camY, 0, maxY) };
}
// The camera top-left that centers tile (tx, ty) in the colony view (load / camTo).
export function centerOn(tx: number, ty: number, zoom: number): { x: number; y: number } {
  const cx = tileCenterX(tx) - VIEW_W / zoom / 2;
  const cy = tileCenterY(ty) - VIEW_H / zoom / 2;
  return clampCamera(cx, cy, zoom);
}
export function worldToScreen(camX: number, camY: number, zoom: number, wx: number, wy: number): { x: number; y: number } {
  return { x: VIEW_X0 + (wx - camX) * zoom, y: VIEW_Y0 + (wy - camY) * zoom };
}
export function screenToWorld(camX: number, camY: number, zoom: number, sx: number, sy: number): { x: number; y: number } {
  return { x: camX + (sx - VIEW_X0) / zoom, y: camY + (sy - VIEW_Y0) / zoom };
}
export function screenToTile(camX: number, camY: number, zoom: number, sx: number, sy: number): PathNode {
  const w = screenToWorld(camX, camY, zoom, sx, sy);
  return { tx: tileOfPixelX(w.x), ty: tileOfPixelY(w.y) };
}

// ---- The world -----------------------------------------------------------------
export class World {
  readonly tiles: Tile[]; // COLS×ROWS row-major (idx(x,y))
  readonly spawns: PathNode[] = []; // EDGE_SPAWNS — the walkable border gaps raiders enter at
  landing: PathNode = { tx: Math.floor(COLS / 2), ty: Math.floor(ROWS / 2) };
  stockpile: PathNode = { tx: Math.floor(COLS / 2), ty: Math.floor(ROWS / 2) }; // hauls deposit here

  constructor(tiles: Tile[]) {
    this.tiles = tiles;
  }

  tileAt(x: number, y: number): Tile | null {
    if (!inBounds(x, y)) return null;
    return this.tiles[idx(x, y)]!;
  }

  // Recompute a tile's derived flags after its terrain / node / structure changed. A built
  // structure blocks/covers/occludes per its STRUCTURES def; a ghost (built === false) does
  // not yet — settlers path to build it (specs/economy.md).
  recompute(t: Tile): void {
    const blockedTerrain = t.terrain === "rock";
    const s = t.structure && t.structure.built ? STRUCTURES[t.structure.kind] : null;
    t.walkable = !blockedTerrain && t.node === null && !(s?.blocksMove ?? false);
    t.blocksSight = blockedTerrain || (s?.blocksSight ?? false);
    t.givesCover = s?.cover ?? false;
  }
  recomputeAt(x: number, y: number): void {
    const t = this.tileAt(x, y);
    if (t) this.recompute(t);
  }
  recomputeAll(): void {
    for (const t of this.tiles) this.recompute(t);
  }

  // Passability for pathfinding. Raiders (forRaider) additionally avoid the colony's doors,
  // so a walled colony with a door does not let them stroll in — they hold outside the wall
  // line (specs/mode-base.md).
  passable(x: number, y: number, forRaider = false): boolean {
    const t = this.tileAt(x, y);
    if (!t || !t.walkable) return false;
    if (forRaider && t.structure && t.structure.built && t.structure.kind === "door") return false;
    return true;
  }

  isFloor(x: number, y: number): boolean {
    const t = this.tileAt(x, y);
    return !!(t && t.structure && t.structure.built && t.structure.kind === "floor");
  }

  // Line of sight / fire between two tile centers: a supercover walk from a→b; any tile
  // between them that blocksSight (wall/door/rock) stops the shot (specs/combat.md). The two
  // endpoint tiles are excluded (a shooter beside a wall still fires out).
  lineOfSight(ax: number, ay: number, bx: number, by: number): boolean {
    const dx = bx - ax;
    const dy = by - ay;
    const dist = Math.hypot(dx, dy);
    const steps = Math.max(1, Math.ceil(dist * 3)); // ~3 samples per tile
    for (let i = 1; i < steps; i++) {
      const f = i / steps;
      const px = ax + dx * f;
      const py = ay + dy * f;
      const tx = Math.floor(px);
      const ty = Math.floor(py);
      if ((tx === ax && ty === ay) || (tx === bx && ty === by)) continue;
      const t = this.tileAt(tx, ty);
      if (t && t.blocksSight) return false;
    }
    return true;
  }

  // Cover (tile granularity): the target is in cover vs the shooter when the tile one step
  // from the target TOWARD the shooter carries a cover-giving structure (wall/door) — the
  // wall soaks part of the incoming fire (specs/combat.md, DESIGN §3.7).
  inCover(targetTx: number, targetTy: number, shooterTx: number, shooterTy: number): boolean {
    const sx = Math.sign(shooterTx - targetTx);
    const sy = Math.sign(shooterTy - targetTy);
    if (sx === 0 && sy === 0) return false;
    const t = this.tileAt(targetTx + sx, targetTy + sy);
    return !!(t && t.givesCover);
  }
}

// ---- Generation ----------------------------------------------------------------
function makeTile(x: number, y: number): Tile {
  return {
    x,
    y,
    terrain: "soil",
    node: null,
    structure: null,
    designated: null,
    walkable: true,
    blocksSight: false,
    givesCover: false,
  };
}

// A rough organic blob grown by a bounded random walk from (cx, cy); returns the visited
// tiles (used for grass belts, rock outcrops, tree stands, and ore veins).
function blob(rng: RNG, cx: number, cy: number, size: number, spread = 1): PathNode[] {
  const out: PathNode[] = [];
  const seen = new Set<number>();
  let x = cx;
  let y = cy;
  for (let i = 0; i < size; i++) {
    const key = y * COLS + x;
    if (!seen.has(key) && x >= BORDER && x < COLS - BORDER && y >= BORDER && y < ROWS - BORDER) {
      seen.add(key);
      out.push({ tx: x, ty: y });
    }
    // step to a nearby tile (spread widens the wander)
    x += rng.between(-spread, spread);
    y += rng.between(-spread, spread);
    x = clamp(x, BORDER, COLS - BORDER - 1);
    y = clamp(y, BORDER, ROWS - BORDER - 1);
  }
  return out;
}

// Generate the base map deterministically from `seed` (specs/world.md, DESIGN §4). Border
// rock, grass belts, interior rock outcrops, tree stands, ore veins, a cleared central
// landing site, and the walkable edge spawn points.
export function generateWorld(seed: number): World {
  const rng = new RNG(seed);
  const tiles: Tile[] = [];
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) tiles.push(makeTile(x, y));
  const world = new World(tiles);
  const at = (x: number, y: number): Tile | null => world.tileAt(x, y);

  // 1. Sealed rock border ring.
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      if (x < BORDER || x >= COLS - BORDER || y < BORDER || y >= ROWS - BORDER) at(x, y)!.terrain = "rock";
    }
  }

  const cx = Math.floor(COLS / 2);
  const cy = Math.floor(ROWS / 2);
  world.landing = { tx: cx, ty: cy };
  world.stockpile = { tx: cx, ty: cy };
  const nearLanding = (x: number, y: number, r: number): boolean => Math.abs(x - cx) <= r && Math.abs(y - cy) <= r;

  // 2. Grass belts (fertile ground — best for farm plots).
  for (let i = 0; i < 5; i++) {
    const gx = rng.between(BORDER + 3, COLS - BORDER - 4);
    const gy = rng.between(BORDER + 3, ROWS - BORDER - 4);
    for (const p of blob(rng, gx, gy, rng.between(24, 40), 2)) {
      const t = at(p.tx, p.ty)!;
      if (t.terrain !== "rock") t.terrain = "grass";
    }
  }

  // 3. Interior rock outcrops — shape where the colony can expand and where raiders funnel.
  for (let i = 0; i < 5; i++) {
    const rx = rng.between(BORDER + 4, COLS - BORDER - 5);
    const ry = rng.between(BORDER + 4, ROWS - BORDER - 5);
    if (nearLanding(rx, ry, 8)) continue; // never wall the landing in
    for (const p of blob(rng, rx, ry, rng.between(6, 14), 1)) {
      if (nearLanding(p.tx, p.ty, 6)) continue;
      at(p.tx, p.ty)!.terrain = "rock";
    }
  }

  // 4. Tree stands (clusters, not scattered singles — chopping is a deliberate objective).
  const canNode = (x: number, y: number): boolean => {
    const t = at(x, y);
    return !!(t && t.terrain !== "rock" && t.node === null && !nearLanding(x, y, 4));
  };
  for (let i = 0; i < 8; i++) {
    const tx = rng.between(BORDER + 2, COLS - BORDER - 3);
    const ty = rng.between(BORDER + 2, ROWS - BORDER - 3);
    for (const p of blob(rng, tx, ty, rng.between(8, 16), 1)) {
      if (!canNode(p.tx, p.ty)) continue;
      if (!rng.chance(0.72)) continue; // ragged stand edges
      const t = at(p.tx, p.ty)!;
      t.node = { kind: "tree", hp: 0, maxHp: 0, claimedBy: null, workAnim: 0 };
      t.node.maxHp = t.node.hp = 2.0; // CHOP_HP (kept local to avoid a cycle; matches constants)
    }
  }

  // 5. Ore veins (contiguous runs — worth routing a miner to).
  for (let i = 0; i < 4; i++) {
    let vx = rng.between(BORDER + 3, COLS - BORDER - 4);
    let vy = rng.between(BORDER + 3, ROWS - BORDER - 4);
    const run = rng.between(4, 9);
    const dir = rng.pick([
      { dx: 1, dy: 0 },
      { dx: 0, dy: 1 },
      { dx: 1, dy: 1 },
      { dx: 1, dy: -1 },
    ]);
    for (let k = 0; k < run; k++) {
      if (canNode(vx, vy)) {
        const t = at(vx, vy)!;
        t.node = { kind: "ore", hp: 5.0, maxHp: 5.0, claimedBy: null, workAnim: 0 }; // MINE_HP
      }
      vx = clamp(vx + dir.dx + rng.between(-1, 1) * 0, BORDER, COLS - BORDER - 1);
      vy = clamp(vy + dir.dy, BORDER, ROWS - BORDER - 1);
    }
  }

  // 6. Clear the landing site: a cleared open apron of soil, no nodes, where the crew and
  // the stockpile sit and the first buildings go up.
  for (let y = cy - 3; y <= cy + 3; y++) {
    for (let x = cx - 4; x <= cx + 4; x++) {
      const t = at(x, y);
      if (!t) continue;
      t.terrain = "soil";
      t.node = null;
    }
  }

  // 7. Edge spawn points — walkable gaps cut into the sealed border at each edge midpoint.
  const spawns: PathNode[] = [
    { tx: cx, ty: BORDER },
    { tx: cx, ty: ROWS - BORDER - 1 },
    { tx: BORDER, ty: cy },
    { tx: COLS - BORDER - 1, ty: cy },
  ];
  for (const s of spawns) {
    // open the border tile itself plus a short throat inward so the spawn is truly reachable
    for (let d = 0; d <= 1; d++) {
      const t = at(s.tx + Math.sign(cx - s.tx) * d, s.ty + Math.sign(cy - s.ty) * d);
      if (t) {
        t.terrain = "soil";
        t.node = null;
      }
    }
    at(s.tx, s.ty)!.terrain = "soil";
    at(s.tx, s.ty)!.node = null;
    world.spawns.push(s);
  }

  world.recomputeAll();
  return world;
}

// Attach a built/ghost structure to a tile and refresh the tile's derived flags.
export function setStructure(world: World, s: Structure | null, x: number, y: number): void {
  const t = world.tileAt(x, y);
  if (!t) return;
  t.structure = s;
  world.recompute(t);
}
