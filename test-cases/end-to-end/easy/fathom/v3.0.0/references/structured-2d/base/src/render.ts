// Fathom — every mark the game makes on the canvas.
//
// The engine owns the pipeline: it collects the trench's draw components,
// orders them by layer and hands each the context already carrying the
// world-to-device transform, so everything below is drawn in the logical units
// `specs/overview.md` fixes and never reads a canvas size of its own. Each
// function here is a PURE READ of the live `FathomState`, writing nothing back
// (`specs/state.md`, The contract).
//
// What comes from the seeded art and what is drawn in code is fixed by
// `specs/assets.md`: the creatures, the maze tiles and the flare bloom are
// sheets; the fog shading, the light pocket, the plankton, the wavefronts, the
// amber bulbs, the alert flashes, the ink, the HUD and every screen are code. A
// sheet frame that did not arrive is drawn as the shape beneath it instead, so
// the picture still reads on a host that cannot decode images.

import {
  ALERT_TIME,
  DIVE_LABEL,
  FLARE_BLOOM,
  FLARE_CHARGE,
  FLARE_RADIUS,
  GAMEOVER_ITEMS,
  GRID_COLS,
  GRID_ORIGIN_X,
  GRID_ORIGIN_Y,
  GRID_ROWS,
  INK_COOLDOWN,
  PAUSE_ITEMS,
  PLANKTON_DOT,
  SONAR_COOLDOWN,
  STAGE_H,
  STAGE_W,
  TAGLINE_TEXT,
  TILE,
  TITLE_ITEMS,
  TITLE_TEXT,
} from "./constants";
import type { Drifter, Forager, Predator } from "./creatures";
import { FLARE_FADE } from "./predators";
import { COUNTDOWN_STEPS, COUNTDOWN_TIME } from "./flow";
import type { Dir } from "./grid";
import { cellIndex, tileCenterX, tileCenterY } from "./grid";
import { bodyCell } from "./movement";
import { SONAR_CREST_TILES, drifterDrawn, predatorDrawn } from "./sim";
import type { Frame } from "./sprites";
import { TRENCH_FLOOR, TRENCH_FOG, TRENCH_GATE, sheets } from "./sprites";
import { COLOR, font, rgba } from "./theme";
import type { FathomState, Screen } from "./game";

const MAZE_W = GRID_COLS * TILE;
const MAZE_H = GRID_ROWS * TILE;
const HUD_BOTTOM_Y = GRID_ORIGIN_Y + MAZE_H;

/** How far a remembered tile is drawn down from a lit one. */
const REMEMBERED_ALPHA = 0.55;

/** Whether a maze is on screen, which is when the trench and the HUD draw. */
export function mazeOnScreen(screen: Screen): boolean {
  return (
    screen === "countdown" ||
    screen === "playing" ||
    screen === "paused" ||
    screen === "cleared"
  );
}

// ---- The trench ----------------------------------------------------------

/** The tiles, the light pocket, the plankton and the ink. */
export function renderTrench(
  state: FathomState,
  ctx: CanvasRenderingContext2D,
): void {
  if (!mazeOnScreen(state.screen)) return;
  ctx.save();
  ctx.beginPath();
  ctx.rect(GRID_ORIGIN_X, GRID_ORIGIN_Y, MAZE_W, MAZE_H);
  ctx.clip();

  drawTiles(state, ctx);
  drawLightPocket(state.forager, ctx);
  drawPlankton(state, ctx);
  drawInk(state, ctx);

  ctx.restore();
}

function drawTiles(state: FathomState, ctx: CanvasRenderingContext2D): void {
  const art = sheets().trench;
  ctx.imageSmoothingEnabled = false;
  for (let ty = 0; ty < GRID_ROWS; ty++) {
    for (let tx = 0; tx < GRID_COLS; tx++) {
      const x = GRID_ORIGIN_X + tx * TILE;
      const y = GRID_ORIGIN_Y + ty * TILE;
      const visibility = state.fog.visibilityAt(tx, ty);
      if (visibility === "u") {
        drawGround(ctx, art[TRENCH_FOG], x, y, COLOR.abyss);
        continue;
      }
      ctx.globalAlpha = visibility === "l" ? 1 : REMEMBERED_ALPHA;
      if (state.maze.isRock(tx, ty)) {
        drawWall(state, ctx, art, tx, ty, x, y);
      } else {
        drawGround(ctx, art[TRENCH_FLOOR], x, y, COLOR.water);
        if (state.maze.isGate(tx, ty)) drawGate(ctx, art[TRENCH_GATE], x, y);
      }
      ctx.globalAlpha = 1;
    }
  }
  ctx.globalAlpha = 1;
  ctx.imageSmoothingEnabled = true;
}

/** A flat 32 x 32 cell: the frame where it arrived, its own color where not. */
function drawGround(
  ctx: CanvasRenderingContext2D,
  frame: Frame,
  x: number,
  y: number,
  fallback: string,
): void {
  if (frame) {
    ctx.drawImage(frame, x, y, TILE, TILE);
    return;
  }
  ctx.fillStyle = fallback;
  ctx.fillRect(x, y, TILE, TILE);
}

/**
 * A rock tile, at the autotile frame its four orthogonal rock neighbors pick
 * (`specs/assets.md`). Without the sheet it is a rock face with a rim light on
 * each side that meets a corridor, which is the same reading.
 */
function drawWall(
  state: FathomState,
  ctx: CanvasRenderingContext2D,
  art: readonly Frame[],
  tx: number,
  ty: number,
  x: number,
  y: number,
): void {
  const mask = state.maze.wallMask(tx, ty);
  const frame = art[mask];
  if (frame) {
    ctx.drawImage(frame, x, y, TILE, TILE);
    return;
  }
  ctx.fillStyle = COLOR.rock;
  ctx.fillRect(x, y, TILE, TILE);
  ctx.fillStyle = COLOR.rim;
  const lip = 2;
  if ((mask & 1) === 0) ctx.fillRect(x, y, TILE, lip);
  if ((mask & 2) === 0) ctx.fillRect(x + TILE - lip, y, lip, TILE);
  if ((mask & 4) === 0) ctx.fillRect(x, y + TILE - lip, TILE, lip);
  if ((mask & 8) === 0) ctx.fillRect(x, y, lip, TILE);
}

function drawGate(
  ctx: CanvasRenderingContext2D,
  frame: Frame,
  x: number,
  y: number,
): void {
  if (frame) {
    ctx.drawImage(frame, x, y, TILE, TILE);
    return;
  }
  ctx.fillStyle = COLOR.gate;
  for (let bar = 0; bar < 3; bar++) {
    ctx.fillRect(x + 4 + bar * 9, y + TILE / 2 - 6, 4, 12);
  }
}

/**
 * The cool glow the forager carries. It reads as light over the maze rather
 * than as a mask, so remembered terrain outside it stays clearly drawn.
 */
function drawLightPocket(
  forager: Forager,
  ctx: CanvasRenderingContext2D,
): void {
  const radius = forager.visionRadius * 1.35;
  const strength = 0.14 + 0.22 * forager.brightness;
  const glow = ctx.createRadialGradient(
    forager.x,
    forager.y,
    0,
    forager.x,
    forager.y,
    radius,
  );
  glow.addColorStop(0, `rgba(70, 240, 224, ${strength})`);
  glow.addColorStop(0.5, `rgba(36, 80, 107, ${strength * 0.5})`);
  glow.addColorStop(1, "rgba(3, 6, 12, 0)");
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(forager.x, forager.y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** A plankton reads as a small point of light on the corridor floor it sits on. */
function drawPlankton(state: FathomState, ctx: CanvasRenderingContext2D): void {
  const radius = PLANKTON_DOT / 2;
  for (let ty = 0; ty < GRID_ROWS; ty++) {
    for (let tx = 0; tx < GRID_COLS; tx++) {
      if (!state.plankton[cellIndex(tx, ty)]) continue;
      const visibility = state.fog.visibilityAt(tx, ty);
      if (visibility === "u") continue;
      const lit = visibility === "l";
      ctx.save();
      ctx.globalAlpha = lit ? 1 : 0.4;
      ctx.fillStyle = COLOR.plankton;
      if (lit) {
        ctx.shadowColor = "rgba(184, 245, 200, 0.85)";
        ctx.shadowBlur = 8;
      }
      ctx.beginPath();
      ctx.arc(tileCenterX(tx), tileCenterY(ty), radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }
}

/** A cloud, visibly darker than the water, over the radius it stands in. */
function drawInk(state: FathomState, ctx: CanvasRenderingContext2D): void {
  for (const cloud of state.inkClouds) {
    const alpha = Math.min(1, cloud.remaining) * 0.9;
    const wash = ctx.createRadialGradient(
      cloud.x,
      cloud.y,
      0,
      cloud.x,
      cloud.y,
      cloud.radius,
    );
    wash.addColorStop(0, rgba(COLOR.ink, alpha));
    wash.addColorStop(0.7, rgba(COLOR.ink, alpha * 0.8));
    wash.addColorStop(1, rgba(COLOR.ink, 0));
    ctx.fillStyle = wash;
    ctx.beginPath();
    ctx.arc(cloud.x, cloud.y, cloud.radius, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ---- The effects ---------------------------------------------------------

/** The wavefronts, the flare blooms and the detection alerts. */
export function renderEffects(
  state: FathomState,
  ctx: CanvasRenderingContext2D,
): void {
  if (!mazeOnScreen(state.screen)) return;
  ctx.save();
  ctx.beginPath();
  ctx.rect(GRID_ORIGIN_X, GRID_ORIGIN_Y, MAZE_W, MAZE_H);
  ctx.clip();

  drawWavefronts(state, ctx);
  drawFlares(state, ctx);
  drawAlerts(state, ctx);

  ctx.restore();
}

/** The radius of curvature of one crest arc, and how wide an angle it spans. */
const CREST_RADIUS = TILE * 0.62;
const CREST_SPREAD = 1.15;
/** A wide faint halo under a narrow bright core. */
const CREST_STROKES = [
  { width: TILE * 0.42, peak: 0.16 },
  { width: TILE * 0.16, peak: 0.7 },
];

/**
 * A wavefront as a glowing crest flowing outward through the corridors: one
 * short arc per flooded tile, bulging the way the sound is travelling, so the
 * crest bends at bends and reflects off rock exactly as the flood does rather
 * than reading as an expanding circle (`specs/sensing.md`).
 */
function drawWavefronts(
  state: FathomState,
  ctx: CanvasRenderingContext2D,
): void {
  if (state.pulses.length === 0) return;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.lineCap = "round";

  for (const pulse of state.pulses) {
    const tint =
      pulse.tint === "cyan"
        ? COLOR.sonarCyan
        : pulse.tint === "violet"
          ? COLOR.sonarViolet
          : COLOR.sonarOrange;
    const furthest = Math.min(
      pulse.buckets.length - 1,
      Math.floor(pulse.front),
    );
    const nearest = Math.max(0, Math.ceil(pulse.front - SONAR_CREST_TILES));
    for (const stroke of CREST_STROKES) {
      ctx.lineWidth = stroke.width;
      for (let step = nearest; step <= furthest; step++) {
        // Brightest right at the leading edge, fading to nothing behind it.
        const behind = pulse.front - step;
        const alpha = (1 - behind / SONAR_CREST_TILES) * stroke.peak;
        if (alpha <= 0) continue;
        ctx.strokeStyle = rgba(tint, alpha);
        for (const cell of pulse.buckets[step]) {
          drawCrestArc(
            ctx,
            pulse.headingAt(cell.tx, cell.ty),
            cell.tx,
            cell.ty,
          );
        }
      }
    }
  }
  ctx.restore();
}

function drawCrestArc(
  ctx: CanvasRenderingContext2D,
  heading: { x: number; y: number } | null,
  tx: number,
  ty: number,
): void {
  const x = tileCenterX(tx);
  const y = tileCenterY(ty);
  ctx.beginPath();
  if (!heading || (heading.x === 0 && heading.y === 0)) {
    // The origin has no heading of its own, so it opens as a full ring.
    ctx.arc(x, y, CREST_RADIUS, 0, Math.PI * 2);
  } else {
    // Centred behind the tile so the crest bulges toward the travel heading.
    const angle = Math.atan2(heading.y, heading.x);
    ctx.arc(
      x - CREST_RADIUS * heading.x,
      y - CREST_RADIUS * heading.y,
      CREST_RADIUS,
      angle - CREST_SPREAD,
      angle + CREST_SPREAD,
    );
  }
  ctx.stroke();
}

/**
 * The flare, from the provided bloom sheet, centred on the Flarefish and scaled
 * so the bloom's lit radius is `FLARE_RADIUS`. It plays the charge, bloom and
 * fade beats `specs/assets.md` lays out and composites as light.
 */
function drawFlares(state: FathomState, ctx: CanvasRenderingContext2D): void {
  const art = sheets().flareBloom;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (const predator of state.predators) {
    if (predator.kind !== "flarefish") continue;
    const beat = flareBeat(predator);
    if (!beat) continue;
    const size = FLARE_RADIUS * 2 * beat.scale;
    const frame = art[beat.frame];
    if (frame) {
      ctx.drawImage(
        frame,
        predator.x - size / 2,
        predator.y - size / 2,
        size,
        size,
      );
      continue;
    }
    const bloom = ctx.createRadialGradient(
      predator.x,
      predator.y,
      0,
      predator.x,
      predator.y,
      size / 2,
    );
    bloom.addColorStop(0, "rgba(255, 244, 214, 0.95)");
    bloom.addColorStop(0.45, "rgba(255, 168, 92, 0.55)");
    bloom.addColorStop(1, "rgba(255, 122, 89, 0)");
    ctx.fillStyle = bloom;
    ctx.beginPath();
    ctx.arc(predator.x, predator.y, size / 2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

interface FlareBeat {
  frame: number;
  scale: number;
}

/** Which beat of the bloom sheet a Flarefish is showing, and at what size. */
function flareBeat(predator: Predator): FlareBeat | null {
  if (predator.flareActive) {
    const phase = predator.flarePhase;
    if (phase < FLARE_CHARGE) {
      const through = phase / FLARE_CHARGE;
      return {
        frame: Math.min(2, Math.floor(through * 3)),
        scale: 0.5 + 0.4 * through,
      };
    }
    const through = (phase - FLARE_CHARGE) / FLARE_BLOOM;
    return { frame: 3 + Math.min(2, Math.floor(through * 3)), scale: 1 };
  }
  if (predator.flareFade <= 0) return null;
  const through = 1 - predator.flareFade / FLARE_FADE;
  return {
    frame: 6 + Math.min(1, Math.floor(through * 2)),
    scale: 1 - 0.3 * through,
  };
}

/** The color a predator's own effects are drawn in. */
function predatorColor(predator: Predator): string {
  if (predator.kind === "gloamfin") return COLOR.gloamfin;
  if (predator.kind === "flarefish") return COLOR.flarefish;
  return COLOR.amberCore;
}

/**
 * The detection alert: a sharp flash in the hunter's own color, centred on it,
 * snapping outward and fading over its window (`specs/predators.md`).
 */
function drawAlerts(state: FathomState, ctx: CanvasRenderingContext2D): void {
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (const predator of state.predators) {
    if (predator.alert <= 0) continue;
    const left = predator.alert / ALERT_TIME;
    const through = 1 - left;
    const color = predatorColor(predator);

    ctx.globalAlpha = left * 0.9;
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 24 * left;
    ctx.beginPath();
    ctx.arc(predator.x, predator.y, 6 + 4 * left, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    ctx.globalAlpha = left * 0.85;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.5 * left + 1;
    ctx.beginPath();
    ctx.arc(predator.x, predator.y, 10 + through * 42, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

// ---- The creatures -------------------------------------------------------

/** The bodies: the predators where they are lit, the drifters, the forager. */
export function renderCreatures(
  state: FathomState,
  ctx: CanvasRenderingContext2D,
): void {
  if (!mazeOnScreen(state.screen)) return;
  ctx.save();
  ctx.beginPath();
  ctx.rect(GRID_ORIGIN_X, GRID_ORIGIN_Y, MAZE_W, MAZE_H);
  ctx.clip();
  ctx.imageSmoothingEnabled = false;

  for (const predator of state.predators) {
    if (!predatorDrawn(state, predator)) continue;
    const cell = bodyCell(predator);
    ctx.globalAlpha = state.fog.showsBody(cell.tx, cell.ty) ? 1 : 0.6;
    drawPredatorBody(state, ctx, predator);
  }
  ctx.globalAlpha = 1;

  for (const drifter of state.drifters) {
    if (!drifterDrawn(state, drifter)) continue;
    drawDrifterBody(state, ctx, drifter);
  }

  drawForager(state, ctx);

  ctx.imageSmoothingEnabled = true;
  ctx.restore();
}

/** The frame pair a facing selects on a per-facing sheet. */
function facingBase(facing: Dir): number {
  switch (facing) {
    case "up":
      return 2;
    case "left":
      return 4;
    case "right":
      return 6;
    default:
      return 0;
  }
}

/** A two-frame swim cycle, held on the closed frame while the body is at rest. */
function swimFrame(
  body: { facing: Dir; heading: Dir | null },
  time: number,
  fps: number,
): number {
  const alternate = body.heading === null ? 0 : Math.floor(time * fps) % 2;
  return facingBase(body.facing) + alternate;
}

/** A creature sprite over its tile, or a shape in its color without the sheet. */
function drawBody(
  ctx: CanvasRenderingContext2D,
  frame: Frame,
  x: number,
  y: number,
  fallback: string,
): void {
  if (frame) {
    ctx.drawImage(frame, x - TILE / 2, y - TILE / 2, TILE, TILE);
    return;
  }
  ctx.fillStyle = fallback;
  ctx.beginPath();
  ctx.ellipse(x, y, TILE * 0.34, TILE * 0.26, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawPredatorBody(
  state: FathomState,
  ctx: CanvasRenderingContext2D,
  predator: Predator,
): void {
  const art = sheets();
  const time = state.simTime;
  if (predator.kind === "gloamfin") {
    drawBody(
      ctx,
      art.gloamfin[swimFrame(predator, time, 8)],
      predator.x,
      predator.y,
      COLOR.gloamfin,
    );
    return;
  }
  if (predator.kind === "flarefish") {
    drawBody(
      ctx,
      art.flarefish[swimFrame(predator, time, 8)],
      predator.x,
      predator.y,
      COLOR.flarefish,
    );
    return;
  }
  // The Lanternjaw hunts in its true body and wanders in the jellyfish
  // disguise, which is the bonus drifter's own art (`specs/assets.md`).
  const frame =
    predator.state === "chase"
      ? art.lanternjaw[swimFrame(predator, time, 7)]
      : art.lanternjaw[8 + (Math.floor(time * 8) % 8)];
  drawBody(ctx, frame, predator.x, predator.y, COLOR.amberCore);
}

function drawDrifterBody(
  state: FathomState,
  ctx: CanvasRenderingContext2D,
  drifter: Drifter,
): void {
  const frame = sheets().drifter[Math.floor(state.simTime * 8) % 8];
  drawBody(ctx, frame, drifter.x, drifter.y, COLOR.amberCore);
}

function drawForager(state: FathomState, ctx: CanvasRenderingContext2D): void {
  const forager = state.forager;
  const frame = sheets().glimmerfin[swimFrame(forager, state.simTime, 9)];
  drawBody(ctx, frame, forager.x, forager.y, COLOR.forager);
}

// ---- The amber lights ----------------------------------------------------

/**
 * The maze's two amber lights, drawn identically and at any distance, across
 * unrevealed fog and through rock: the bonus drifter, and the bulb of every
 * Lanternjaw out of the den (`specs/sensing.md`).
 */
export function renderAmber(
  state: FathomState,
  ctx: CanvasRenderingContext2D,
): void {
  if (!mazeOnScreen(state.screen)) return;
  ctx.save();
  ctx.beginPath();
  ctx.rect(GRID_ORIGIN_X, GRID_ORIGIN_Y, MAZE_W, MAZE_H);
  ctx.clip();
  ctx.globalCompositeOperation = "lighter";

  for (const drifter of state.drifters)
    drawAmberMote(ctx, drifter.x, drifter.y);
  for (const predator of state.predators) {
    if (predator.kind !== "lanternjaw" || predator.state === "den") continue;
    drawAmberMote(ctx, predator.x, predator.y);
  }

  ctx.restore();
}

/** One warm amber mote with a bright core, drawn alike for both lights. */
function drawAmberMote(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
): void {
  const glow = ctx.createRadialGradient(x, y, 0, x, y, 14);
  glow.addColorStop(0, "rgba(255, 240, 194, 0.95)");
  glow.addColorStop(0.45, rgba(COLOR.amber, 0.55));
  glow.addColorStop(1, rgba(COLOR.amber, 0));
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(x, y, 14, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = COLOR.amberCore;
  ctx.beginPath();
  ctx.arc(x, y, 4, 0, Math.PI * 2);
  ctx.fill();
}

// ---- The HUD -------------------------------------------------------------

/**
 * The six things a player reads off the HUD, in the strips above and below the
 * maze region, always fully lit and outside the fog entirely (`specs/ui.md`).
 */
export function renderHud(
  state: FathomState,
  ctx: CanvasRenderingContext2D,
): void {
  if (!mazeOnScreen(state.screen)) return;

  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  ctx.fillStyle = COLOR.text;
  ctx.font = font(48, 700);
  ctx.fillText(pad(state.score, 5), 40, 60);

  ctx.textAlign = "right";
  ctx.font = font(16);
  ctx.fillStyle = COLOR.textFaint;
  ctx.fillText(DIVE_LABEL, STAGE_W - 40, 44);

  drawLives(state, ctx);

  ctx.textAlign = "right";
  ctx.font = font(18);
  ctx.fillStyle = COLOR.textDim;
  ctx.fillText(`DEPTH ${state.depth}`, STAGE_W - 40, HUD_BOTTOM_Y + 34);

  drawGauge(
    ctx,
    STAGE_W / 2 - 150,
    HUD_BOTTOM_Y + 26,
    "SONAR",
    1 - state.sonarCooldown / SONAR_COOLDOWN,
    COLOR.forager,
  );
  drawGauge(
    ctx,
    STAGE_W / 2 + 20,
    HUD_BOTTOM_Y + 26,
    "INK",
    1 - state.inkCooldown / INK_COOLDOWN,
    "#9aa6ff",
  );
}

/** The lives in reserve, as that many small forager icons. */
function drawLives(state: FathomState, ctx: CanvasRenderingContext2D): void {
  const icon = sheets().glimmerfin[facingBase("right")];
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  for (let life = 0; life < state.lives; life++) {
    const x = 40 + life * 26;
    const y = HUD_BOTTOM_Y + 20;
    if (icon) {
      ctx.drawImage(icon, x, y, 20, 20);
      continue;
    }
    ctx.fillStyle = COLOR.forager;
    ctx.beginPath();
    ctx.ellipse(x + 10, y + 10, 8, 6, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** A readiness gauge: full while ready, filling back up as a cooldown runs. */
function drawGauge(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  label: string,
  fraction: number,
  color: string,
): void {
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.font = font(13);
  ctx.fillStyle = COLOR.textFaint;
  ctx.fillText(label, x, y);

  const barX = x + ctx.measureText(label).width + 22;
  const width = 88;
  ctx.fillStyle = "rgba(138, 148, 166, 0.16)";
  roundRect(ctx, barX, y - 3, width, 6, 3);
  ctx.fill();

  ctx.save();
  ctx.fillStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = 8;
  const filled = Math.max(0, Math.min(1, fraction)) * width;
  if (filled > 0) {
    roundRect(ctx, barX, y - 3, filled, 6, 3);
    ctx.fill();
  }
  ctx.restore();
  ctx.textBaseline = "alphabetic";
}

// ---- The screens ---------------------------------------------------------

/** The chrome of whichever screen `screen` names. */
export function renderScreen(
  state: FathomState,
  ctx: CanvasRenderingContext2D,
): void {
  switch (state.screen) {
    case "title":
      drawTitleScreen(state, ctx);
      return;
    case "howto":
      drawHowTo(ctx);
      return;
    case "countdown":
      drawCountdown(state, ctx);
      return;
    case "paused":
      drawPaused(state, ctx);
      return;
    case "cleared":
      drawCleared(state, ctx);
      return;
    case "gameover":
      drawGameOver(state, ctx);
      return;
    default:
      return;
  }
}

function drawTitleScreen(
  state: FathomState,
  ctx: CanvasRenderingContext2D,
): void {
  drawMazeBackdrop(state, ctx);

  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.save();
  ctx.fillStyle = COLOR.forager;
  ctx.font = font(120, 700);
  ctx.shadowColor = "rgba(70, 240, 224, 0.5)";
  ctx.shadowBlur = 28;
  ctx.fillText(TITLE_TEXT, STAGE_W / 2, 258);
  ctx.restore();

  ctx.font = font(22);
  ctx.fillStyle = COLOR.textDim;
  ctx.fillText(TAGLINE_TEXT, STAGE_W / 2, 306);

  drawMenu(ctx, TITLE_ITEMS, state.menuIndex, 420, 60);

  ctx.font = font(16);
  ctx.fillStyle = COLOR.textFaint;
  ctx.fillText("W S / ARROWS MOVE     ENTER SELECT", STAGE_W / 2, STAGE_H - 40);
}

/** A dim slice of trench behind the title, for atmosphere. */
function drawMazeBackdrop(
  state: FathomState,
  ctx: CanvasRenderingContext2D,
): void {
  const art = sheets().trench;
  ctx.save();
  ctx.beginPath();
  ctx.rect(GRID_ORIGIN_X, GRID_ORIGIN_Y, MAZE_W, MAZE_H);
  ctx.clip();
  ctx.imageSmoothingEnabled = false;
  ctx.globalAlpha = 0.14;
  for (let ty = 0; ty < GRID_ROWS; ty++) {
    for (let tx = 0; tx < GRID_COLS; tx++) {
      const x = GRID_ORIGIN_X + tx * TILE;
      const y = GRID_ORIGIN_Y + ty * TILE;
      if (state.maze.isRock(tx, ty)) drawWall(state, ctx, art, tx, ty, x, y);
      else drawGround(ctx, art[TRENCH_FLOOR], x, y, COLOR.water);
    }
  }
  ctx.restore();
}

const HOWTO_LINES: readonly (readonly [string, string])[] = [
  ["MOVE", "Arrow keys, or W A S D"],
  ["SONAR", "Space — floods the corridors ahead, but the Gloamfin hears it"],
  ["INK", "Shift — blinds the hunters that see, but not the one that listens"],
  ["PAUSE", "Esc or P            MUTE  M"],
  ["", ""],
  ["THE LANTERNJAW", "hunts your LIGHT. Go dim, or ink it."],
  [
    "THE GLOAMFIN",
    "hunts your SOUND. Break its fix at a corner; ink is no use.",
  ],
  ["THE FLAREFISH", "shows nothing but its FLARE. Leave the light, or ink it."],
  ["", ""],
  ["Light travels straight. Sound bends around corners.", ""],
  ["Graze every plankton to descend. Contact costs a life.", ""],
];

function drawHowTo(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = COLOR.abyss;
  ctx.fillRect(0, 0, STAGE_W, STAGE_H);

  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = COLOR.forager;
  ctx.font = font(52, 700);
  ctx.fillText("HOW TO PLAY", STAGE_W / 2, 120);

  const keyRight = STAGE_W / 2 - 220;
  const valueLeft = STAGE_W / 2 - 200;
  let y = 200;
  for (const [key, value] of HOWTO_LINES) {
    ctx.font = font(20);
    if (!key && !value) {
      y += 16;
      continue;
    }
    if (value) {
      ctx.fillStyle = COLOR.forager;
      ctx.textAlign = "right";
      ctx.fillText(key, keyRight, y);
      ctx.fillStyle = COLOR.textDim;
      ctx.textAlign = "left";
      ctx.fillText(value, valueLeft, y);
    } else {
      ctx.fillStyle = COLOR.text;
      ctx.textAlign = "center";
      ctx.fillText(key, STAGE_W / 2, y);
    }
    y += 40;
  }

  ctx.textAlign = "center";
  ctx.font = font(16);
  ctx.fillStyle = COLOR.textFaint;
  ctx.fillText("ESC  BACK", STAGE_W / 2, STAGE_H - 40);
}

function drawCountdown(
  state: FathomState,
  ctx: CanvasRenderingContext2D,
): void {
  const step = COUNTDOWN_TIME / COUNTDOWN_STEPS;
  const showing = Math.max(1, Math.ceil(state.countdown / step));
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = COLOR.forager;
  ctx.shadowColor = "rgba(70, 240, 224, 0.6)";
  ctx.shadowBlur = 24;
  ctx.font = font(40, 700);
  ctx.fillText("DIVE", STAGE_W / 2, STAGE_H / 2 - 30);
  ctx.font = font(96, 700);
  ctx.fillText(String(showing), STAGE_W / 2, STAGE_H / 2 + 60);
  ctx.restore();
}

function drawPaused(state: FathomState, ctx: CanvasRenderingContext2D): void {
  scrim(ctx, 0.78);
  panel(ctx);
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = COLOR.textDim;
  ctx.font = font(18);
  ctx.fillText("HOLD FAST", STAGE_W / 2, STAGE_H / 2 - 120);
  ctx.fillStyle = COLOR.forager;
  ctx.font = font(52, 700);
  ctx.fillText("PAUSED", STAGE_W / 2, STAGE_H / 2 - 66);
  drawMenu(ctx, PAUSE_ITEMS, state.menuIndex, STAGE_H / 2 + 10, 50);
}

function drawCleared(state: FathomState, ctx: CanvasRenderingContext2D): void {
  scrim(ctx, 0.6);
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = COLOR.forager;
  ctx.font = font(64, 700);
  ctx.shadowColor = "rgba(70, 240, 224, 0.5)";
  ctx.shadowBlur = 28;
  ctx.fillText(`DEPTH ${state.depth} CLEARED`, STAGE_W / 2, STAGE_H / 2);
  ctx.restore();
  ctx.font = font(20);
  ctx.fillStyle = COLOR.textDim;
  ctx.textAlign = "center";
  ctx.fillText("DESCENDING", STAGE_W / 2, STAGE_H / 2 + 50);
}

function drawGameOver(state: FathomState, ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = COLOR.abyss;
  ctx.fillRect(0, 0, STAGE_W, STAGE_H);
  scrim(ctx, 0.64);
  panel(ctx);

  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = COLOR.textDim;
  ctx.font = font(18);
  ctx.fillText("LOST IN THE DARK", STAGE_W / 2, STAGE_H / 2 - 130);
  ctx.fillStyle = COLOR.forager;
  ctx.font = font(52, 700);
  ctx.fillText("GAME OVER", STAGE_W / 2, STAGE_H / 2 - 74);
  ctx.fillStyle = COLOR.text;
  ctx.font = font(36);
  ctx.fillText(`SCORE ${pad(state.score, 5)}`, STAGE_W / 2, STAGE_H / 2 - 24);
  ctx.fillStyle = COLOR.textDim;
  ctx.font = font(20);
  ctx.fillText(`REACHED DEPTH ${state.depth}`, STAGE_W / 2, STAGE_H / 2 + 12);

  drawMenu(ctx, GAMEOVER_ITEMS, state.menuIndex, STAGE_H / 2 + 66, 48);
}

/** A vertical menu, its selected item drawn distinctly from the others. */
function drawMenu(
  ctx: CanvasRenderingContext2D,
  items: readonly string[],
  selected: number,
  top: number,
  gap: number,
): void {
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.font = font(30);
  items.forEach((item, index) => {
    const y = top + index * gap;
    if (index === selected) {
      ctx.fillStyle = COLOR.text;
      ctx.fillText(`> ${item} <`, STAGE_W / 2, y);
    } else {
      ctx.fillStyle = COLOR.textDim;
      ctx.fillText(item, STAGE_W / 2, y);
    }
  });
}

// ---- Primitives ----------------------------------------------------------

function scrim(ctx: CanvasRenderingContext2D, alpha: number): void {
  ctx.fillStyle = `rgba(2, 4, 8, ${alpha})`;
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
  width: number,
  height: number,
  radius: number,
): void {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function pad(value: number, width: number): string {
  const digits = String(Math.max(0, Math.floor(value)));
  return digits.length >= width
    ? digits
    : "0".repeat(width - digits.length) + digits;
}
