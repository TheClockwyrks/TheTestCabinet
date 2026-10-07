// Spectra — the starfield behind the play field.
//
// `specs/field.md` asks for at least `STARFIELD_MIN` marks, distinct from the
// field behind them, sitting behind everything the field carries and never as
// bright as a drone of either band. The layout, the motion if it has any, and how
// a mark is drawn are the build's, and this is the build's answer: a still field
// of small discs in two dim blues, in three depths so the block reads as depth
// rather than as noise.
//
// The layout is not a random choice the game makes: it is a fixed scatter hashed
// from each mark's own index, so it is the same on every load and takes nothing
// from the draws the game makes in play.

import { FIELD_BOTTOM, FIELD_TOP, STAGE_W } from "./constants";
import { COLOR } from "./theme";
import type { Star } from "./types";

/** The constant the layout is hashed from, so every load shows the same sky. */
export const STARFIELD_SALT = 0x5c0e;

/** A cursor over a hashed sequence of units, one per mark. */
class Scatter {
  private state: number;

  constructor(salt: number) {
    this.state = salt >>> 0;
  }

  /** The next unit in `[0, 1)`. */
  unit(): number {
    const s = (this.state + 0x6d2b79f5) | 0;
    this.state = s >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** The next value in `[low, high)`. */
  range(low: number, high: number): number {
    return low + this.unit() * (high - low);
  }
}

/** Build `count` marks across the play field. */
export function buildStars(count: number): Star[] {
  const scatter = new Scatter(STARFIELD_SALT);
  const stars: Star[] = [];
  for (let i = 0; i < count; i += 1) {
    // A third of the marks are the brighter tier, and the brighter ones are
    // larger, so the field reads as three depths.
    const near = scatter.unit() < 0.34;
    stars.push({
      x: scatter.range(2, STAGE_W - 2),
      y: scatter.range(FIELD_TOP + 4, FIELD_BOTTOM - 4),
      r: near ? scatter.range(1.1, 1.9) : scatter.range(0.6, 1.1),
      color: near ? COLOR.starBright : COLOR.star,
    });
  }
  return stars;
}

/** Draw the starfield, behind everything the field carries. */
export function drawStars(
  ctx: CanvasRenderingContext2D,
  stars: readonly Star[],
): void {
  for (const star of stars) {
    ctx.fillStyle = star.color;
    ctx.beginPath();
    ctx.arc(star.x, star.y, star.r, 0, Math.PI * 2);
    ctx.fill();
  }
}
