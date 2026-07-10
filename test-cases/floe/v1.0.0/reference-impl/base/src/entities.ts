// Floe — the two live actors: the player's Critter and the hunting Bear. Both are
// tile creatures that HOP one tile at a time (specs/controls.md, specs/hunter.md).
// Each keeps a logical tile position plus an eased render position, so movement
// reads as discrete hops with a little arc, never a smooth glide.

import {
  BEAR_ICE_HOP,
  HOP_ANIM,
  ROW_NEAR,
  TILE,
} from "./constants";
import { colToX, rowToY, xToCol } from "./grid";
import type { Dir } from "./types";

function smoothstep(t: number): number {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
}

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

// The hunting bear. It advances tile by tile toward a target the game supplies;
// this class only owns the hop animation and readable state.
export class Bear {
  col: number;
  row: number;
  private prevCol: number;
  private prevRow: number;
  rx: number;
  ry: number;
  hopElapsed = 0;
  hopDur = BEAR_ICE_HOP;
  facing: Dir = "up";
  swimming = false;
  lunge = 0; // >0 while the strike frame plays on a catch

  constructor(col: number, row: number) {
    this.col = col;
    this.row = row;
    this.prevCol = col;
    this.prevRow = row;
    this.rx = colToX(col);
    this.ry = rowToY(row);
  }

  centerX(): number {
    return this.rx + TILE / 2;
  }
  centerY(): number {
    return this.ry + TILE / 2;
  }

  // Begin a hop into (col,row); `dur` is this hop's cadence, `swimming` its footing.
  hopTo(col: number, row: number, dur: number, swimming: boolean): void {
    this.prevCol = this.col;
    this.prevRow = this.row;
    if (col !== this.col || row !== this.row) {
      if (col < this.col) this.facing = "left";
      else if (col > this.col) this.facing = "right";
      else if (row < this.row) this.facing = "up";
      else this.facing = "down";
    }
    this.col = col;
    this.row = row;
    this.hopDur = dur;
    this.swimming = swimming;
    this.hopElapsed = 0;
  }

  // Advance the hop animation; returns true when the hop has completed and the
  // bear is ready to choose its next tile.
  advance(dt: number): boolean {
    this.hopElapsed += dt;
    if (this.lunge > 0) this.lunge = Math.max(0, this.lunge - dt);
    // Travel across the first 70% of the cadence, then settle so the hop reads
    // as discrete.
    const travel = this.hopDur * 0.7;
    const f = smoothstep(this.hopElapsed / travel);
    const fromX = colToX(this.prevCol);
    const fromY = rowToY(this.prevRow);
    const toX = colToX(this.col);
    const toY = rowToY(this.row);
    this.rx = fromX + (toX - fromX) * f;
    this.ry = fromY + (toY - fromY) * f;
    // Hop arc only when actually changing tiles.
    if (this.prevCol !== this.col || this.prevRow !== this.row) {
      this.ry += -Math.sin(Math.min(1, this.hopElapsed / travel) * Math.PI) * 6;
    }
    return this.hopElapsed >= this.hopDur;
  }
}
