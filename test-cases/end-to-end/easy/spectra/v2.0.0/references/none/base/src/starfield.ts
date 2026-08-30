// Spectra — the starfield behind the play field.
//
// `specs/field.md` asks for at least `STARFIELD_MIN` marks, distinct from the
// field behind them, sitting behind everything the field carries and never as
// bright as a drone of either band. The layout, the motion if it has any, and how
// a mark is drawn are the build's, and this is the build's answer: a still field
// of small discs in two dim blues, in three depths so the block reads as depth
// rather than as noise.
//
// The layout is drawn from ITS OWN generator, seeded from a constant. It is not a
// random choice the game makes: it is fixed the moment the page loads, is the
// same on every load, and never touches the state's own generator — so nothing
// about the starfield can shift the sequence the wave's layout, the dive choice
// or a burst's scatter are drawn from.

import { FIELD_BOTTOM, FIELD_TOP, STAGE_W } from "./constants";
import { Rng, seedRng } from "./rng";
import { COLOR } from "./theme";
import type { Star } from "./types";

/** The seed the layout is drawn from, so every load shows the same sky. */
export const STARFIELD_SEED = 0x5c0e;

/** Build `count` marks across the play field. */
export function buildStars(count: number): Star[] {
  const rng = new Rng(seedRng(STARFIELD_SEED));
  const stars: Star[] = [];
  for (let i = 0; i < count; i += 1) {
    // A third of the marks are the brighter tier, and the brighter ones are
    // larger, so the field reads as three depths.
    const near = rng.unit() < 0.34;
    stars.push({
      x: rng.range(2, STAGE_W - 2),
      y: rng.range(FIELD_TOP + 4, FIELD_BOTTOM - 4),
      r: near ? rng.range(1.1, 1.9) : rng.range(0.6, 1.1),
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
