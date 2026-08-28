// Fathom — every canvas draw.
//
// The look is bioluminescence in the abyss: cold light glowing out of a
// near-black trench (`specs/overview.md`). This module draws the maze from its
// tileset under the three visibility states the fog of war reports, the
// creatures and the flare from the sheets `specs/assets.md` lays out, and
// everything else — the light, the plankton, the wavefronts, the ink, the alert
// bursts, the amber lights, the HUD and every screen — in code.
//
// This dive is seen through the vision circle, and the circle is a MASK drawn
// here rather than a sense: `drawVisionMask` below paints the maze back to flat
// fog beyond the radius the brightness gives, over the trench and the plankton
// and under everything the specification lets show past it. Nothing else in the
// build knows the circle exists.
//
// It is a PURE READ of the state the tick left. Nothing here writes a field,
// so what is on screen never feeds back into what the simulation does. Where a
// body is drawn between two ticks it is drawn from `alpha`, the fraction of a
// tick the wall clock has covered since the last one.

import {
  BLOOM_BEATS,
  facingBase,
  LANTERNJAW_DISGUISE,
  TRENCH_FLOOR,
  TRENCH_FOG,
  TRENCH_GATE,
  type Assets,
  type Sheet,
} from "./assets";
import {
  ALERT_TIME,
  DIVE_LABEL,
  FLARE_BLOOM,
  FLARE_CHARGE,
  FLARE_RADIUS,
  GRID_COLS,
  GRID_ORIGIN_X,
  GRID_ORIGIN_Y,
  GRID_ROWS,
  INK_COOLDOWN,
  PLANKTON_DOT,
  SONAR_COOLDOWN,
  STAGE_H,
  STAGE_W,
  TAGLINE_TEXT,
  TILE,
  TITLE_TEXT,
} from "./constants";
import type { Burst } from "./effects";
import type { Mover, Predator } from "./entities";
import type { FathomState } from "./game";
import { Maze } from "./maze";
import { FLARE_FADE, isBlooming } from "./predators";
import {
  countdownNumber,
  mazeOnScreen,
  menuItems,
  predatorLit,
  windowRadius,
} from "./readings";
import { tileKey } from "./sensing";
import type { SonarWave } from "./sonar";
import {
  COLOR,
  HUD_BOTTOM_Y,
  HUD_MARGIN,
  MONO,
  PULSE_BAND,
  PULSE_RGB,
  SCORE_DIGITS,
  SCORE_FONT_PX,
  SWIM_FPS,
} from "./theme";
import type { PredatorKind } from "./types";

const MAZE_W = GRID_COLS * TILE;
const MAZE_H = GRID_ROWS * TILE;

/** The radius of curvature, and the half-angle, of one wavefront crest arc. */
const CREST_RADIUS = TILE * 0.62;
const CREST_SPREAD = 1.15;

/** Each hunter's own color, which its alert burst flashes in. */
const PREDATOR_COLOR: Readonly<Record<PredatorKind, string>> = {
  lanternjaw: COLOR.amber,
  gloamfin: COLOR.gloamfin,
  flarefish: COLOR.flarefish,
};

/** Draw one whole frame of the game. */
export function render(
  state: FathomState,
  ctx: CanvasRenderingContext2D,
  alpha: number,
): void {
  ctx.fillStyle = COLOR.fog;
  ctx.fillRect(0, 0, STAGE_W, STAGE_H);

  const overMaze = mazeOnScreen(state.screen);
  if (overMaze) drawMaze(state, ctx, alpha);

  switch (state.screen) {
    case "title":
      drawTitle(state, ctx);
      break;
    case "howto":
      drawHowTo(ctx);
      break;
    case "countdown":
      drawCountdown(state, ctx);
      break;
    case "paused":
      drawPaused(state, ctx);
      break;
    case "cleared":
      drawCleared(state, ctx);
      break;
    case "gameover":
      drawGameOver(state, ctx);
      break;
    case "playing":
      break;
  }

  // Drawn last, so the HUD is always fully lit: it stands outside the fog of
  // war entirely, and outside the dim a menu lays over the frozen maze.
  if (overMaze) drawHud(state, ctx);
}

// ---- The trench ------------------------------------------------------------

/** The whole maze region: terrain, light, creatures and effects, in that order. */
function drawMaze(
  state: FathomState,
  ctx: CanvasRenderingContext2D,
  alpha: number,
): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(GRID_ORIGIN_X, GRID_ORIGIN_Y, MAZE_W, MAZE_H);
  ctx.clip();

  drawTerrain(state, ctx);
  drawLightPocket(state, ctx, alpha);
  drawPlankton(state, ctx);
  drawInk(state, ctx);
  drawVisionMask(state, ctx, alpha);
  drawFlareLight(state, ctx, alpha);
  drawWavefronts(state, ctx, alpha);
  drawBlooms(state, ctx, alpha);
  drawBursts(state, ctx);
  drawBodies(state, ctx, alpha);
  drawAmberLights(state, ctx, alpha);

  ctx.restore();
}

/**
 * Every tile, under the visibility the fog reports for it: unrevealed as the
 * flat fog tile, remembered dim, lit at full brightness.
 */
function drawTerrain(state: FathomState, ctx: CanvasRenderingContext2D): void {
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  for (let row = 0; row < GRID_ROWS; row += 1) {
    for (let col = 0; col < GRID_COLS; col += 1) {
      const x = GRID_ORIGIN_X + col * TILE;
      const y = GRID_ORIGIN_Y + row * TILE;
      if (!state.fog.isRevealed(col, row)) {
        drawTile(ctx, state.assets.trench, TRENCH_FOG, x, y);
        continue;
      }
      ctx.globalAlpha = state.fog.isLit(col, row) ? 1 : 0.6;
      drawTileAt(state, ctx, col, row, x, y);
      ctx.globalAlpha = 1;
    }
  }
  ctx.restore();
}

/** One revealed tile: the wall autotile, the corridor floor, or the den gate. */
function drawTileAt(
  state: FathomState,
  ctx: CanvasRenderingContext2D,
  col: number,
  row: number,
  x: number,
  y: number,
): void {
  const trench = state.assets.trench;
  if (state.maze.isRock(col, row)) {
    drawTile(ctx, trench, state.maze.wallFrame(col, row), x, y);
    return;
  }
  drawTile(ctx, trench, TRENCH_FLOOR, x, y);
  if (state.maze.isGate(col, row)) drawTile(ctx, trench, TRENCH_GATE, x, y);
}

function drawTile(
  ctx: CanvasRenderingContext2D,
  sheet: Sheet,
  frame: number,
  x: number,
  y: number,
): void {
  ctx.drawImage(sheet[frame], x, y, TILE, TILE);
}

/**
 * The forager's own light: a soft cool glow filling the vision circle, its
 * strength climbing with the brightness `G` that drives the circle's radius.
 */
function drawLightPocket(
  state: FathomState,
  ctx: CanvasRenderingContext2D,
  alpha: number,
): void {
  const forager = state.forager;
  const reach = windowRadius(state);
  const strength = 0.14 + 0.22 * forager.brightness;
  const x = forager.viewX(alpha);
  const y = forager.viewY(alpha);
  const glow = ctx.createRadialGradient(x, y, 0, x, y, reach);
  glow.addColorStop(0, `rgba(70,240,224,${strength})`);
  glow.addColorStop(0.5, `rgba(36,80,107,${strength * 0.5})`);
  glow.addColorStop(1, "rgba(3,6,12,0)");
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(x, y, reach, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** A plankton mote on every revealed tile still carrying one. */
function drawPlankton(state: FathomState, ctx: CanvasRenderingContext2D): void {
  ctx.save();
  for (let row = 0; row < GRID_ROWS; row += 1) {
    for (let col = 0; col < GRID_COLS; col += 1) {
      if (!state.fog.isRevealed(col, row)) continue;
      drawPlanktonAt(state, ctx, col, row);
    }
  }
  ctx.restore();
}

/**
 * The mote on one tile, if it still holds one: bright where the tile is lit
 * this instant, a faint speck where it is only remembered.
 */
function drawPlanktonAt(
  state: FathomState,
  ctx: CanvasRenderingContext2D,
  col: number,
  row: number,
): void {
  if (!state.plankton[tileKey(col, row)]) return;
  const lit = state.fog.isLit(col, row);
  ctx.fillStyle = COLOR.plankton;
  ctx.globalAlpha = lit ? 1 : 0.4;
  ctx.shadowColor = "rgba(184,245,200,0.85)";
  ctx.shadowBlur = lit ? 8 : 0;
  ctx.beginPath();
  ctx.arc(
    Maze.centerX(col),
    Maze.centerY(row),
    PLANKTON_DOT / 2,
    0,
    Math.PI * 2,
  );
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.shadowBlur = 0;
}

/** Every ink cloud still standing, darker than the water it hangs in. */
function drawInk(state: FathomState, ctx: CanvasRenderingContext2D): void {
  for (const cloud of state.ink.all) {
    // Thinning over its last second, so a cloud is visibly dissipating rather
    // than snapping out of existence.
    const density = Math.min(1, cloud.remaining) * 0.9;
    const fill = ctx.createRadialGradient(
      cloud.x,
      cloud.y,
      0,
      cloud.x,
      cloud.y,
      cloud.radius,
    );
    fill.addColorStop(0, `rgba(11,10,31,${density})`);
    fill.addColorStop(0.7, `rgba(11,10,31,${density * 0.8})`);
    fill.addColorStop(1, "rgba(11,10,31,0)");
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.arc(cloud.x, cloud.y, cloud.radius, 0, Math.PI * 2);
    ctx.fill();
  }
}

/**
 * The vision circle: every part of the maze region beyond `R` of the forager is
 * painted back to the flat unrevealed fog.
 *
 * The fill is the maze region with a circular hole cut in it, wound the other
 * way, so the edge is cut at the PIXEL and runs through the middle of a tile as
 * readily as along one. It senses nothing: the fog of war beneath is untouched,
 * so ground the circle hides stays remembered and is drawn again, plankton and
 * all, when the forager comes back within `R` of it.
 *
 * Everything drawn after this stands over the blackout and so shows beyond the
 * circle: the flare's disc, both wavefronts, the alert bursts and the creature
 * bodies. The amber lights are drawn last of all and clip themselves to it.
 */
function drawVisionMask(
  state: FathomState,
  ctx: CanvasRenderingContext2D,
  alpha: number,
): void {
  const x = state.forager.viewX(alpha);
  const y = state.forager.viewY(alpha);
  ctx.save();
  ctx.fillStyle = COLOR.fog;
  ctx.beginPath();
  ctx.rect(GRID_ORIGIN_X, GRID_ORIGIN_Y, MAZE_W, MAZE_H);
  ctx.arc(x, y, windowRadius(state), 0, Math.PI * 2, true);
  ctx.fill();
  ctx.restore();
}

/**
 * The disc a burning bloom lights: within the flare radius, stuck to the
 * Flarefish and moving with it, the trench is drawn at full brightness — floor
 * and rock alike, straight through any rock between, and over the vision mask,
 * so a flare beyond the circle is a second window onto the maze. It is full
 * vision, so it draws even ground that has never been explored.
 */
function drawFlareLight(
  state: FathomState,
  ctx: CanvasRenderingContext2D,
  alpha: number,
): void {
  for (const p of state.predators) {
    if (!isBlooming(p)) continue;
    const x = p.viewX(alpha);
    const y = p.viewY(alpha);
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, FLARE_RADIUS, 0, Math.PI * 2);
    ctx.clip();
    ctx.imageSmoothingEnabled = false;
    const reach = Math.ceil(FLARE_RADIUS / TILE) + 1;
    for (let row = p.row - reach; row <= p.row + reach; row += 1) {
      if (row < 0 || row >= GRID_ROWS) continue;
      for (let col = p.col - reach; col <= p.col + reach; col += 1) {
        if (col < 0 || col >= GRID_COLS) continue;
        drawTileAt(
          state,
          ctx,
          col,
          row,
          GRID_ORIGIN_X + col * TILE,
          GRID_ORIGIN_Y + row * TILE,
        );
      }
    }
    // The plankton with it, so the disc is a window onto the whole maze rather
    // than onto its walls: the mask above has just painted them out.
    ctx.imageSmoothingEnabled = true;
    for (let row = p.row - reach; row <= p.row + reach; row += 1) {
      if (row < 0 || row >= GRID_ROWS) continue;
      for (let col = p.col - reach; col <= p.col + reach; col += 1) {
        if (col < 0 || col >= GRID_COLS) continue;
        drawPlanktonAt(state, ctx, col, row);
      }
    }
    ctx.restore();
  }
}

/**
 * Every wavefront in flight, drawn as a travelling crest rather than an
 * expanding circle.
 *
 * The crest at each tile is a short arc bulging the way the sound is actually
 * moving through that tile, so it bends at bends and reflects off rock exactly
 * where the pulse does. Consecutive tiles along a run give a marching train of
 * arcs, brightest at the leading edge and fading behind it; the origin, which
 * has no heading, opens as a full ring.
 */
function drawWavefronts(
  state: FathomState,
  ctx: CanvasRenderingContext2D,
  alpha: number,
): void {
  if (state.waves.length === 0) return;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.lineCap = "round";
  // Two strokes per arc: a wide, faint halo under a narrow, bright core.
  const strokes = [
    { width: TILE * 0.42, peak: 0.16 },
    { width: TILE * 0.16, peak: 0.7 },
  ];
  for (const wave of state.waves) {
    const front = wave.viewFront(alpha);
    const rgb = PULSE_RGB[wave.tint];
    for (const stroke of strokes) {
      ctx.lineWidth = stroke.width;
      drawCrest(ctx, wave, front, rgb, stroke.peak);
    }
  }
  ctx.restore();
}

function drawCrest(
  ctx: CanvasRenderingContext2D,
  wave: SonarWave,
  front: number,
  rgb: string,
  peak: number,
): void {
  for (let d = 0; d < wave.buckets.length; d += 1) {
    const behind = front - d;
    if (behind < 0 || behind > PULSE_BAND) continue;
    const strength = (1 - behind / PULSE_BAND) * peak;
    ctx.strokeStyle = `rgba(${rgb},${strength})`;
    for (const cell of wave.buckets[d]) {
      const x = Maze.centerX(cell.col);
      const y = Maze.centerY(cell.row);
      const travel = wave.travelThrough(cell.col, cell.row);
      ctx.beginPath();
      if (travel === null || (travel.x === 0 && travel.y === 0)) {
        // No heading: the origin, or two fronts meeting head-on.
        ctx.arc(x, y, CREST_RADIUS, 0, Math.PI * 2);
      } else {
        // Centred behind the tile, so the crest bulges toward the heading and
        // curves back the way it came.
        const heading = Math.atan2(travel.y, travel.x);
        ctx.arc(
          x - CREST_RADIUS * travel.x,
          y - CREST_RADIUS * travel.y,
          CREST_RADIUS,
          heading - CREST_SPREAD,
          heading + CREST_SPREAD,
        );
      }
      ctx.stroke();
    }
  }
}

/** Every flare, from the bloom sheet: the charge, the bloom, and the fade. */
function drawBlooms(
  state: FathomState,
  ctx: CanvasRenderingContext2D,
  alpha: number,
): void {
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.imageSmoothingEnabled = true;
  for (const p of state.predators) {
    const beat = bloomBeat(p);
    if (beat === null) continue;
    // Frame 5, the widest and brightest, is scaled so its lit radius is the
    // flare radius; the charge and the fade are drawn a little smaller.
    const size = FLARE_RADIUS * 2 * beat.scale;
    ctx.drawImage(
      state.assets.flareBloom[beat.frame],
      p.viewX(alpha) - size / 2,
      p.viewY(alpha) - size / 2,
      size,
      size,
    );
  }
  ctx.restore();
}

/** Which bloom frame a Flarefish is showing, and at what size. */
function bloomBeat(p: Predator): { frame: number; scale: number } | null {
  if (p.kind !== "flarefish") return null;
  const t = p.flarePhaseT;
  switch (p.flarePhase) {
    case "charge":
      return {
        frame: beatFrame(BLOOM_BEATS.charge, t / FLARE_CHARGE),
        scale: 0.5 + 0.4 * (t / FLARE_CHARGE),
      };
    case "bloom":
      return {
        frame: beatFrame(BLOOM_BEATS.bloom, t / FLARE_BLOOM),
        scale: 1,
      };
    case "fade":
      return {
        frame: beatFrame(BLOOM_BEATS.fade, t / FLARE_FADE),
        scale: 1 - 0.3 * (t / FLARE_FADE),
      };
    case "none":
      return null;
  }
}

/** The frame a beat is on, `progress` of the way through it. */
function beatFrame(
  beat: { from: number; count: number },
  progress: number,
): number {
  const step = Math.floor(Math.max(0, Math.min(1, progress)) * beat.count);
  return beat.from + Math.min(beat.count - 1, step);
}

/**
 * The detection-alert flashes: a sharp burst in the hunter's own color,
 * snapping outward and fading over the alert window.
 */
function drawBursts(state: FathomState, ctx: CanvasRenderingContext2D): void {
  const bursts = state.effects.all;
  if (bursts.length === 0) return;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (const burst of bursts) drawBurst(ctx, burst);
  ctx.restore();
}

function drawBurst(ctx: CanvasRenderingContext2D, burst: Burst): void {
  const progress = Math.min(1, burst.elapsed / ALERT_TIME);
  const fade = 1 - progress;
  const color = PREDATOR_COLOR[burst.kind];
  ctx.globalAlpha = fade * 0.9;
  ctx.fillStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = 24 * fade;
  ctx.beginPath();
  ctx.arc(burst.x, burst.y, 6 + 4 * fade, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.globalAlpha = fade * 0.85;
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.5 * fade + 1;
  ctx.beginPath();
  ctx.arc(burst.x, burst.y, 10 + progress * 42, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = 1;
}

/**
 * The creature bodies: the hunters and the drifters only where they are lit
 * this instant, and the forager always.
 */
function drawBodies(
  state: FathomState,
  ctx: CanvasRenderingContext2D,
  alpha: number,
): void {
  ctx.save();
  ctx.imageSmoothingEnabled = false;

  for (const p of state.predators) {
    if (!predatorLit(state, p)) continue;
    // A body a sonar mark alone is showing is drawn dimmer than one the
    // forager's own light falls on, so a mark reads as a glimpse.
    ctx.globalAlpha = state.fog.isLit(p.col, p.row) || p.alertT > 0 ? 1 : 0.6;
    drawSprite(ctx, predatorSheet(state.assets, p), predatorFrame(p), p, alpha);
  }
  ctx.globalAlpha = 1;

  // A drifter's jellyfish body shows only where the forager's own light falls
  // on it: a sonar pulse never resolves which amber glimmer is which.
  for (const d of state.drifters) {
    if (!state.fog.isLit(d.col, d.row)) continue;
    drawSprite(ctx, state.assets.drifter, drifterFrame(d), d, alpha);
  }

  drawSprite(
    ctx,
    state.assets.forager,
    swimFrame(state.forager),
    state.forager,
    alpha,
  );
  ctx.restore();
}

/** One 32 x 32 frame, centered on the body's interpolated position. */
function drawSprite(
  ctx: CanvasRenderingContext2D,
  sheet: Sheet,
  frame: number,
  body: Mover,
  alpha: number,
): void {
  ctx.drawImage(
    sheet[frame],
    body.viewX(alpha) - TILE / 2,
    body.viewY(alpha) - TILE / 2,
    TILE,
    TILE,
  );
}

/** The two-frame swim pair for a body's facing, alternating while it travels. */
function swimFrame(body: Mover): number {
  const alternate =
    body.dir !== null ? Math.floor(body.animT * SWIM_FPS) % 2 : 0;
  return facingBase(body.facing) + alternate;
}

/** A drifter's sway loop, which reads the same whichever way it drifts. */
function drifterFrame(body: Mover): number {
  return Math.floor(body.animT * SWIM_FPS) % 8;
}

function predatorSheet(assets: Assets, p: Predator): Sheet {
  switch (p.kind) {
    case "lanternjaw":
      return assets.lanternjaw;
    case "gloamfin":
      return assets.gloamfin;
    case "flarefish":
      return assets.flarefish;
  }
}

/**
 * Which frame a hunter is drawn on.
 *
 * The Lanternjaw is the exception: chasing it shows its true body and its jaws,
 * and wandering it wears the jellyfish disguise — the very frames the bonus
 * drifter is drawn from — so up close an undetected one reads as a drifter.
 */
function predatorFrame(p: Predator): number {
  if (p.kind !== "lanternjaw" || p.state === "chase") return swimFrame(p);
  return LANTERNJAW_DISGUISE + drifterFrame(p);
}

/**
 * The maze's two amber lights, drawn identically: the bonus drifter, and every
 * out-of-den Lanternjaw's bulb. Which glimmer is which is not readable at a
 * glance.
 *
 * They are clipped to the vision circle. Inside it a mote shows whatever the fog
 * beneath it says and wherever the light pocket fails to reach; beyond it the
 * mote is gone with the ground around it, so a glimmer only appears as it drifts
 * into the window.
 */
function drawAmberLights(
  state: FathomState,
  ctx: CanvasRenderingContext2D,
  alpha: number,
): void {
  const fx = state.forager.viewX(alpha);
  const fy = state.forager.viewY(alpha);
  const radius = windowRadius(state);
  const inWindow = (x: number, y: number): boolean =>
    Math.hypot(x - fx, y - fy) <= radius;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (const d of state.drifters) {
    const x = d.viewX(alpha);
    const y = d.viewY(alpha);
    if (inWindow(x, y)) drawAmberMote(ctx, x, y);
  }
  for (const p of state.predators) {
    if (p.kind !== "lanternjaw" || p.state === "den") continue;
    const x = p.viewX(alpha);
    const y = p.viewY(alpha);
    if (inWindow(x, y)) drawAmberMote(ctx, x, y);
  }
  ctx.restore();
}

/** One warm, red-leaning amber mote with a bright core. */
function drawAmberMote(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
): void {
  const glow = ctx.createRadialGradient(x, y, 0, x, y, 14);
  glow.addColorStop(0, "rgba(255,240,194,0.95)");
  glow.addColorStop(0.45, "rgba(255,209,102,0.55)");
  glow.addColorStop(1, "rgba(255,209,102,0)");
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(x, y, 14, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = COLOR.amberCore;
  ctx.beginPath();
  ctx.arc(x, y, 4, 0, Math.PI * 2);
  ctx.fill();
}

// ---- The HUD ---------------------------------------------------------------

/**
 * The strips above and below the maze region. Always fully lit, standing
 * outside the fog of war entirely.
 */
function drawHud(state: FathomState, ctx: CanvasRenderingContext2D): void {
  ctx.save();
  ctx.textBaseline = "alphabetic";

  ctx.textAlign = "left";
  ctx.fillStyle = COLOR.text;
  ctx.font = `700 ${SCORE_FONT_PX}px ${MONO}`;
  ctx.fillText(padScore(state.score), HUD_MARGIN, 60);

  ctx.textAlign = "right";
  ctx.font = `16px ${MONO}`;
  ctx.fillStyle = COLOR.textFaint;
  ctx.fillText(DIVE_LABEL, STAGE_W - HUD_MARGIN, 44);

  ctx.imageSmoothingEnabled = false;
  for (let i = 0; i < state.lives; i += 1) {
    ctx.drawImage(
      state.assets.forager[facingBase("right")],
      HUD_MARGIN + i * 26,
      HUD_BOTTOM_Y + 20,
      20,
      20,
    );
  }
  ctx.imageSmoothingEnabled = true;

  ctx.textAlign = "right";
  ctx.font = `18px ${MONO}`;
  ctx.fillStyle = COLOR.textDim;
  ctx.fillText(`DEPTH ${state.depth}`, STAGE_W - HUD_MARGIN, HUD_BOTTOM_Y + 34);

  drawGauge(
    ctx,
    STAGE_W / 2 - 150,
    HUD_BOTTOM_Y + 26,
    "SONAR",
    1 - state.sonarCooldown / SONAR_COOLDOWN,
    COLOR.sonar,
  );
  drawGauge(
    ctx,
    STAGE_W / 2 + 20,
    HUD_BOTTOM_Y + 26,
    "INK",
    1 - state.inkCooldown / INK_COOLDOWN,
    "#9aa6ff",
  );
  ctx.restore();
}

/** A gauge that is full while its ability is ready and refills as it cools. */
function drawGauge(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  label: string,
  fraction: number,
  color: string,
): void {
  ctx.save();
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.font = `13px ${MONO}`;
  ctx.fillStyle = COLOR.textFaint;
  ctx.fillText(label, x, y);
  const barX = x + ctx.measureText(label).width + 22;
  const width = 88;
  ctx.fillStyle = "rgba(138,148,166,0.16)";
  roundRect(ctx, barX, y - 3, width, 6, 3);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = 8;
  roundRect(ctx, barX, y - 3, Math.max(0, width * Math.min(1, fraction)), 6, 3);
  ctx.fill();
  ctx.restore();
}

/** The score, padded so its width does not jump as it climbs. */
function padScore(score: number): string {
  return String(Math.max(0, Math.floor(score))).padStart(SCORE_DIGITS, "0");
}

// ---- The screens -----------------------------------------------------------

function drawTitle(state: FathomState, ctx: CanvasRenderingContext2D): void {
  drawTrenchBackdrop(state, ctx);
  ctx.save();
  ctx.textAlign = "center";
  ctx.fillStyle = COLOR.forager;
  ctx.font = `700 128px ${MONO}`;
  ctx.shadowColor = "rgba(70,240,224,0.5)";
  ctx.shadowBlur = 28;
  ctx.fillText(TITLE_TEXT, STAGE_W / 2, 258);
  ctx.shadowBlur = 0;
  ctx.font = `22px ${MONO}`;
  ctx.fillStyle = COLOR.textDim;
  ctx.fillText(TAGLINE_TEXT, STAGE_W / 2, 306);
  ctx.restore();

  drawMenu(state, ctx, 420, 60);
  drawFooter(ctx, "UP DOWN  MOVE     ENTER  SELECT");
}

/** A dim, dark slice of maze behind the title. */
function drawTrenchBackdrop(
  state: FathomState,
  ctx: CanvasRenderingContext2D,
): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(GRID_ORIGIN_X, GRID_ORIGIN_Y, MAZE_W, MAZE_H);
  ctx.clip();
  ctx.imageSmoothingEnabled = false;
  ctx.globalAlpha = 0.14;
  for (let row = 0; row < GRID_ROWS; row += 1) {
    for (let col = 0; col < GRID_COLS; col += 1) {
      drawTileAt(
        state,
        ctx,
        col,
        row,
        GRID_ORIGIN_X + col * TILE,
        GRID_ORIGIN_Y + row * TILE,
      );
    }
  }
  ctx.restore();
}

function drawHowTo(ctx: CanvasRenderingContext2D): void {
  ctx.save();
  ctx.fillStyle = COLOR.fog;
  ctx.fillRect(0, 0, STAGE_W, STAGE_H);
  ctx.textAlign = "center";
  ctx.fillStyle = COLOR.forager;
  ctx.font = `700 52px ${MONO}`;
  ctx.fillText("HOW TO PLAY", STAGE_W / 2, 116);

  const rows: readonly (readonly [string, string])[] = [
    ["MOVE", "ARROW KEYS or W A S D"],
    ["SONAR", "SPACE — floods the corridors, and is heard"],
    ["INK", "SHIFT — blinds the hunters that see"],
    ["PAUSE", "ESC or P            MUTE  M"],
    ["", ""],
    ["THE LANTERNJAW", "hunts your light. Go dim, or ink it."],
    ["THE GLOAMFIN", "hunts your sound. Ink is no use against it."],
    ["THE FLAREFISH", "shows nothing but its flare. Leave the light."],
    ["", ""],
    ["You see the trench only inside your window. Eat to widen it.", ""],
    ["Your own glow shows only what is in a straight line.", ""],
    ["A sonar pulse bends round corners and shows the rest.", ""],
    ["Graze every plankton to descend. Contact costs a life.", ""],
  ];
  const keyRight = STAGE_W / 2 - 200;
  const valueLeft = STAGE_W / 2 - 180;
  let y = 192;
  for (const [key, value] of rows) {
    ctx.font = `20px ${MONO}`;
    if (key === "" && value === "") {
      y += 16;
      continue;
    }
    if (value === "") {
      ctx.fillStyle = COLOR.text;
      ctx.textAlign = "center";
      ctx.fillText(key, STAGE_W / 2, y);
    } else {
      ctx.fillStyle = COLOR.forager;
      ctx.textAlign = "right";
      ctx.fillText(key, keyRight, y);
      ctx.fillStyle = COLOR.textDim;
      ctx.textAlign = "left";
      ctx.fillText(value, valueLeft, y);
    }
    y += 38;
  }
  ctx.restore();
  drawFooter(ctx, "ENTER or ESC  BACK");
}

function drawCountdown(
  state: FathomState,
  ctx: CanvasRenderingContext2D,
): void {
  ctx.save();
  ctx.textAlign = "center";
  ctx.fillStyle = COLOR.forager;
  ctx.shadowColor = "rgba(70,240,224,0.6)";
  ctx.shadowBlur = 24;
  ctx.font = `700 40px ${MONO}`;
  ctx.fillText("DIVE", STAGE_W / 2, STAGE_H / 2 - 30);
  ctx.font = `700 96px ${MONO}`;
  ctx.fillText(
    String(countdownNumber(state.countdown)),
    STAGE_W / 2,
    STAGE_H / 2 + 60,
  );
  ctx.restore();
}

function drawPaused(state: FathomState, ctx: CanvasRenderingContext2D): void {
  dim(ctx, 0.78);
  panel(ctx);
  ctx.save();
  ctx.textAlign = "center";
  ctx.fillStyle = COLOR.textDim;
  ctx.font = `18px ${MONO}`;
  ctx.fillText("HOLD FAST", STAGE_W / 2, STAGE_H / 2 - 120);
  ctx.fillStyle = COLOR.forager;
  ctx.font = `700 52px ${MONO}`;
  ctx.fillText("PAUSED", STAGE_W / 2, STAGE_H / 2 - 66);
  ctx.restore();
  drawMenu(state, ctx, STAGE_H / 2 + 10, 50);
}

function drawCleared(state: FathomState, ctx: CanvasRenderingContext2D): void {
  dim(ctx, 0.6);
  ctx.save();
  ctx.textAlign = "center";
  ctx.fillStyle = COLOR.forager;
  ctx.font = `700 64px ${MONO}`;
  ctx.shadowColor = "rgba(70,240,224,0.5)";
  ctx.shadowBlur = 28;
  ctx.fillText(`DEPTH ${state.depth} CLEARED`, STAGE_W / 2, STAGE_H / 2);
  ctx.shadowBlur = 0;
  ctx.font = `20px ${MONO}`;
  ctx.fillStyle = COLOR.textDim;
  ctx.fillText("DESCENDING", STAGE_W / 2, STAGE_H / 2 + 50);
  ctx.restore();
}

function drawGameOver(state: FathomState, ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = COLOR.fog;
  ctx.fillRect(0, 0, STAGE_W, STAGE_H);
  dim(ctx, 0.64);
  panel(ctx);
  ctx.save();
  ctx.textAlign = "center";
  ctx.fillStyle = COLOR.textDim;
  ctx.font = `18px ${MONO}`;
  ctx.fillText("LOST IN THE DARK", STAGE_W / 2, STAGE_H / 2 - 130);
  ctx.fillStyle = COLOR.forager;
  ctx.font = `700 52px ${MONO}`;
  ctx.fillText("GAME OVER", STAGE_W / 2, STAGE_H / 2 - 74);
  ctx.fillStyle = COLOR.text;
  ctx.font = `36px ${MONO}`;
  ctx.fillText(`SCORE ${padScore(state.score)}`, STAGE_W / 2, STAGE_H / 2 - 24);
  ctx.fillStyle = COLOR.textDim;
  ctx.font = `20px ${MONO}`;
  ctx.fillText(`REACHED DEPTH ${state.depth}`, STAGE_W / 2, STAGE_H / 2 + 12);
  ctx.restore();
  drawMenu(state, ctx, STAGE_H / 2 + 66, 48);
}

/** The current screen's menu, with its selected item drawn distinctly. */
function drawMenu(
  state: FathomState,
  ctx: CanvasRenderingContext2D,
  top: number,
  gap: number,
): void {
  ctx.save();
  ctx.textAlign = "center";
  ctx.font = `30px ${MONO}`;
  menuItems(state.screen).forEach((item, index) => {
    const y = top + index * gap;
    if (index === state.menu) {
      ctx.fillStyle = COLOR.text;
      ctx.fillText(`> ${item} <`, STAGE_W / 2, y);
    } else {
      ctx.fillStyle = COLOR.textDim;
      ctx.fillText(item, STAGE_W / 2, y);
    }
  });
  ctx.restore();
}

function drawFooter(ctx: CanvasRenderingContext2D, text: string): void {
  ctx.save();
  ctx.textAlign = "center";
  ctx.font = `16px ${MONO}`;
  ctx.fillStyle = COLOR.textFaint;
  ctx.fillText(text, STAGE_W / 2, STAGE_H - 40);
  ctx.restore();
}

// ---- Primitives ------------------------------------------------------------

function dim(ctx: CanvasRenderingContext2D, strength: number): void {
  ctx.fillStyle = `rgba(2,4,8,${strength})`;
  ctx.fillRect(0, 0, STAGE_W, STAGE_H);
}

function panel(ctx: CanvasRenderingContext2D): void {
  const width = 560;
  const height = 380;
  ctx.save();
  ctx.fillStyle = COLOR.panel;
  ctx.strokeStyle = COLOR.panelBorder;
  ctx.lineWidth = 1;
  roundRect(
    ctx,
    STAGE_W / 2 - width / 2,
    STAGE_H / 2 - height / 2,
    width,
    height,
    18,
  );
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}
