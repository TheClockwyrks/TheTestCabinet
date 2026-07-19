// Floe — the two live actors: the player's Critter and the hunting Bear. The
// critter HOPS one tile at a time (specs/controls.md); the bear moves CONTINUOUSLY,
// pacman-style — a smooth glide at a fixed speed, turning only at tile centers
// (specs/hunter.md). The critter keeps a logical tile position plus an eased render
// position so its movement reads as discrete hops; the bear's position is itself
// continuous, so it is rendered directly.

import {
  HOP_ANIM,
  ROW_NEAR,
  TILE,
} from "./constants";
import { colToX, rowToY, xToCol } from "./grid";
import type { Dir } from "./types";

// The player critter. Its horizontal position is a float (px) so a floe can carry
// it smoothly; its row is an integer changed only by hops.
export class Critter {
  x = colToX(20); // strait-local left px of the 32px sprite
  row = ROW_NEAR;
  facing: Dir = "up";
  rx = this.x; // eased render px
  ry = rowToY(ROW_NEAR);
  hopT = 0; // seconds left of the leap frame / hop arc

  centerX(): number {
    return this.x + TILE / 2;
  }
  col(): number {
    return xToCol(this.x);
  }

  place(col: number, row: number): void {
    this.x = colToX(col);
    this.row = row;
    this.rx = this.x;
    this.ry = rowToY(row);
    this.hopT = 0;
    this.facing = "up";
  }

  startHop(facing: Dir): void {
    this.facing = facing;
    this.hopT = HOP_ANIM;
  }

  // Ease the render position toward the logical tile; advance the hop timer.
  advance(dt: number): void {
    const k = 1 - Math.exp(-dt * 26);
    this.rx += (this.x - this.rx) * k;
    this.ry += (rowToY(this.row) - this.ry) * k;
    if (this.hopT > 0) this.hopT = Math.max(0, this.hopT - dt);
  }

  // A small vertical hop arc, in px (negative = up), for rendering.
  hopArc(): number {
    if (this.hopT <= 0) return 0;
    const p = 1 - this.hopT / HOP_ANIM; // 0..1 across the hop
    return -Math.sin(p * Math.PI) * 7;
  }
}

// The hunting bear. It glides CONTINUOUSLY toward a target tile the game supplies
// (specs/hunter.md): it holds a current tile (the last one it settled on) and a
// target tile one step away, and slides smoothly between them at `speed` px/s.
// It changes direction only on reaching the target — so its turning is quantized
// to the grid while its motion stays smooth. rx/ry ARE its logical position (there
// is nothing to ease); while between tiles it occupies both `col`/`row` and
// `targetCol`/`targetRow` for hazard collision.
export class Bear {
  col: number; // the tile it last settled on (the one it is leaving)
  row: number;
  targetCol: number; // the adjacent tile it is gliding toward
  targetRow: number;
  rx: number; // continuous strait-local top-left px (also the render position)
  ry: number;
  speed = 0; // px/second of the current glide
  facing: Dir = "up";
  swimming = false;
  lunge = 0; // >0 while the strike frame plays on a catch

  constructor(col: number, row: number) {
    this.col = col;
    this.row = row;
    this.targetCol = col;
    this.targetRow = row;
    this.rx = colToX(col);
    this.ry = rowToY(row);
  }

  centerX(): number {
    return this.rx + TILE / 2;
  }
  centerY(): number {
    return this.ry + TILE / 2;
  }

  // Commit to gliding into the adjacent (col,row) at `speed` px/s; `swimming` is
  // the footing of that step (open water vs ice/floe). Sets the facing from the
  // direction of travel.
  setTarget(col: number, row: number, speed: number, swimming: boolean): void {
    this.targetCol = col;
    this.targetRow = row;
    this.speed = speed;
    this.swimming = swimming;
    if (col < this.col) this.facing = "left";
    else if (col > this.col) this.facing = "right";
    else if (row < this.row) this.facing = "up";
    else if (row > this.row) this.facing = "down";
  }

  // Glide toward the target tile's top-left. Returns true when the bear has
  // reached it and settled (col/row snap to the target) — the game then chooses
  // the next step. Motion is axis-aligned (one grid step at a time).
  advance(dt: number): boolean {
    if (this.lunge > 0) this.lunge = Math.max(0, this.lunge - dt);
    const toX = colToX(this.targetCol);
    const toY = rowToY(this.targetRow);
    const dx = toX - this.rx;
    const dy = toY - this.ry;
    const dist = Math.abs(dx) + Math.abs(dy); // axis-aligned: only one is nonzero
    const step = this.speed * dt;
    if (dist <= step || dist < 1e-4) {
      this.rx = toX;
      this.ry = toY;
      this.col = this.targetCol;
      this.row = this.targetRow;
      return true;
    }
    this.rx += Math.sign(dx) * step;
    this.ry += Math.sign(dy) * step;
    return false;
  }
}
