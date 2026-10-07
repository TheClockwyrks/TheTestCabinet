// Fathom — every frame the game draws.
//
// `render` is handed the state `update` returned, as a read-only view, and a 2D
// context that is already cleared and already carrying the logical transform, so
// everything below is written in the fixed 1280 x 720 logical units
// `specs/overview.md` fixes and nothing here reads the canvas element's size.
// The state arrives read-only, which is what guarantees that drawing a frame
// changes nothing about the simulation.
//
// The trench is drawn from the seeded art (`specs/assets.md`) — the wall
// autotile, the floor, the unrevealed ground, the gate, the four creatures and
// the flare bloom — over which the light, the plankton, the wavefronts, the ink,
// the amber lights, the alert flashes, the HUD and every screen are drawn in
// code. A sheet frame that could not be loaded falls back to the same shape drawn
// in code, so the game still reads correctly in a host that cannot decode an
// image.
//
// Over all of that sits the vision circle (`specs/sensing.md`): a rendering mask
// that paints the maze back to the flat unrevealed fog beyond a radius `R` of the
// forager. It is cut on the path rather than tile by tile, it senses nothing, and
// the three things drawn after it — a flare bloom, the forager's sonar wavefront
// and the Gloamfin's ping — show beyond it.

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
import {
  TRENCH_FLOOR,
  TRENCH_FOG,
  TRENCH_GATE,
  type Frames,
  type Sheets,
} from "./assets";
import { COUNTDOWN_BEAT } from "./flow";
import { centerX, centerY, tileIndex } from "./grid";
import { isGate, isRock, wallMask } from "./maze";
import { itemBaseline } from "./menu";
import { FLARE_FADE, flaring } from "./predators";
import { drifterLit, windowRadius } from "./sensing";
import {
  COLOR,
  FORAGER_FPS,
  GAUGE_W,
  HUD_BOT_Y,
  HUD_MARGIN,
  HUNT_FPS,
  INK_GAUGE_X,
  LIVES_GAP,
  LIVES_ICON,
  MONO,
  REMEMBERED_ALPHA,
  SCORE_DIGITS,
  SCORE_FONT_PX,
  SONAR_ARC_R,
  SONAR_ARC_SPREAD,
  SONAR_BAND,
  SONAR_GAUGE_X,
  SONAR_RGB,
  SWAY_FPS,
} from "./theme";
import type {
  Dir,
  FathomState,
  MazeState,
  PredatorState,
  PulseState,
  Screen,
  Tile,
} from "./state";
import type { DeepReadonly } from "ts-essentials";

type Ctx = CanvasRenderingContext2D;
type State = DeepReadonly<FathomState>;

const MAZE_W = GRID_COLS * TILE;
const MAZE_H = GRID_ROWS * TILE;
const HALF = TILE / 2;

/** The maze region is on screen for these four screens (`specs/ui.md`). */
function showsMaze(screen: FathomState["screen"]): boolean {
  return (
    screen === "countdown" ||
    screen === "playing" ||
    screen === "paused" ||
    screen === "cleared"
  );
}

/** One frame of the game. */
export function renderGame(state: State, ctx: Ctx): void {
  ctx.fillStyle = COLOR.bg;
  ctx.fillRect(0, 0, STAGE_W, STAGE_H);

  if (showsMaze(state.screen)) {
    drawTrench(state, ctx);
    drawHud(state, ctx);
  }

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
}

// ---- The sheets ----------------------------------------------------------

/**
 * One frame of a sheet, drawn into the box centered on `(x, y)`.
 *
 * Returns whether the frame was there, so a caller can draw its own fallback
 * where the art could not be loaded.
 */
function drawFrame(
  ctx: Ctx,
  frames: Frames,
  index: number,
  x: number,
  y: number,
  size: number,
): boolean {
  const frame = frames[index];
  if (frame === undefined || frame === null) return false;
  ctx.drawImage(frame, x - size / 2, y - size / 2, size, size);
  return true;
}

/** The first frame of the two-frame pair for `facing` (`specs/assets.md`). */
function facingBase(facing: Dir): number {
  switch (facing) {
    case "down":
      return 0;
    case "up":
      return 2;
    case "left":
      return 4;
    case "right":
      return 6;
  }
}

/** The swim frame for a body: the pair alternates while it travels. */
function swimFrame(
  facing: Dir,
  moving: boolean,
  simTime: number,
  fps: number,
): number {
  return facingBase(facing) + (moving ? Math.floor(simTime * fps) % 2 : 0);
}

/** The frame of an eight-frame sway loop. */
function swayFrame(simTime: number): number {
  return Math.floor(simTime * SWAY_FPS) % 8;
}

// ---- The trench ----------------------------------------------------------

function drawTrench(state: State, ctx: Ctx): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(GRID_ORIGIN_X, GRID_ORIGIN_Y, MAZE_W, MAZE_H);
  ctx.clip();

  // The order is the fog of war's, then the vision circle's. The revealed maze
  // is drawn first, with the forager's own glow and the plankton over it, and the
  // mask then paints every revealed tile beyond `R` back to the flat unrevealed
  // fog. The never-revealed ground goes on top of all of it, so a tile no source
  // has ever reached stays the flat darkness `specs/overview.md` requires however
  // close a light or a mask edge passes it, and the ink follows, cut to the
  // circle like everything else the maze itself carries.
  drawRevealedTiles(state, ctx);
  drawLightPocket(state, ctx);
  drawPlankton(state, ctx);
  drawVisionMask(state, ctx);
  drawFogTiles(state, ctx);
  drawInk(state, ctx);

  // Everything after the fog is something that shows through the mask. A burning
  // flare punches the maze back through it inside its own disc and then draws its
  // bloom; the wavefronts, the tells, the alert flashes and the bodies are not
  // governed by the circle at all. The amber lights are, and they cut themselves
  // to it.
  drawFlareDiscs(state, ctx);
  drawBlooms(state, ctx);
  drawPulses(state, ctx);
  drawFlareTells(state, ctx);
  drawAlerts(state, ctx);
  drawCreatures(state, ctx);
  drawAmberLights(state, ctx);

  ctx.restore();
}

/**
 * Every revealed tile (`specs/sensing.md`): the tile itself at full brightness
 * where a source holds it this instant, and the same tile dim where it is only
 * remembered.
 */
function drawRevealedTiles(state: State, ctx: Ctx): void {
  ctx.imageSmoothingEnabled = false;
  for (let ty = 0; ty < GRID_ROWS; ty++) {
    for (let tx = 0; tx < GRID_COLS; tx++) {
      const index = tileIndex(tx, ty);
      if (!state.revealed[index]) continue;
      ctx.globalAlpha = state.lit[index] ? 1 : REMEMBERED_ALPHA;
      drawGround(
        ctx,
        state.sheets,
        state.maze,
        tx,
        ty,
        GRID_ORIGIN_X + tx * TILE,
        GRID_ORIGIN_Y + ty * TILE,
      );
      ctx.globalAlpha = 1;
    }
  }
  ctx.imageSmoothingEnabled = true;
}

/**
 * Every tile no source has ever reached, drawn opaque over whatever the light
 * painted, so it reads the same over rock as over open water and no glow leaks
 * into the dark.
 */
function drawFogTiles(state: State, ctx: Ctx): void {
  ctx.imageSmoothingEnabled = false;
  for (let ty = 0; ty < GRID_ROWS; ty++) {
    for (let tx = 0; tx < GRID_COLS; tx++) {
      if (state.revealed[tileIndex(tx, ty)]) continue;
      drawFogTile(ctx, state.sheets, tx, ty);
    }
  }
  ctx.imageSmoothingEnabled = true;
}

/**
 * One tile of the flat unrevealed fog, from the sheet or from the code fallback
 * where the sheet could not be loaded.
 *
 * The vision mask paints with this same tile, which is what makes ground beyond
 * the circle read as the never-revealed ground `specs/sensing.md` asks for rather
 * than as a second darkness of its own.
 */
function drawFogTile(
  ctx: Ctx,
  sheets: DeepReadonly<Sheets>,
  tx: number,
  ty: number,
): void {
  const x = GRID_ORIGIN_X + tx * TILE;
  const y = GRID_ORIGIN_Y + ty * TILE;
  if (drawFrame(ctx, sheets.trench, TRENCH_FOG, x + HALF, y + HALF, TILE)) {
    return;
  }
  ctx.fillStyle = COLOR.fog;
  ctx.fillRect(x, y, TILE, TILE);
}

/**
 * The vision circle (`specs/sensing.md`): everything more than `R` from the
 * forager's center is painted back to the flat unrevealed fog.
 *
 * The cut is made on the path — the maze rectangle wound one way and the circle
 * of radius `R` wound the other, leaving a rectangle with a circular hole — so
 * the edge runs through the middle of a tile as readily as along one. Nothing
 * here touches the fog of war: what the mask hides stays revealed underneath and
 * is drawn again, dim, once the circle returns to it.
 *
 * Only the revealed tiles are painted over, because the never-revealed ground is
 * drawn after this and carries the same fog anyway, and it is the revealed ground
 * alone that the mask has anything to take back.
 */
function drawVisionMask(state: State, ctx: Ctx): void {
  const { x, y } = state.forager;
  const radius = windowRadius(state.brightness);
  ctx.save();
  ctx.beginPath();
  ctx.rect(GRID_ORIGIN_X, GRID_ORIGIN_Y, MAZE_W, MAZE_H);
  ctx.moveTo(x + radius, y);
  ctx.arc(x, y, radius, 0, Math.PI * 2, true);
  ctx.clip();
  ctx.imageSmoothingEnabled = false;
  for (let ty = 0; ty < GRID_ROWS; ty++) {
    for (let tx = 0; tx < GRID_COLS; tx++) {
      if (!state.revealed[tileIndex(tx, ty)]) continue;
      drawFogTile(ctx, state.sheets, tx, ty);
    }
  }
  ctx.restore();
}

/**
 * A burning flare's disc, punched back through the vision mask
 * (`specs/sensing.md`): inside `FLARE_RADIUS` of a flaring Flarefish the maze is
 * drawn again at full brightness, however far outside the forager's own circle
 * the Flarefish stands.
 *
 * The disc is exactly the one the simulation lights, so every tile in it is
 * revealed and lit while the bloom burns and it is drawn from the ordinary fog of
 * war rather than from a second rule. When the bloom ends the disc goes with it:
 * nothing redraws it, and the mask below is what is left.
 */
function drawFlareDiscs(state: State, ctx: Ctx): void {
  for (const p of state.predators) {
    if (p.mode === "den" || !flaring(p)) continue;
    ctx.save();
    ctx.beginPath();
    ctx.arc(p.x, p.y, FLARE_RADIUS, 0, Math.PI * 2);
    ctx.clip();
    drawRevealedTiles(state, ctx);
    drawPlankton(state, ctx);
    ctx.restore();
  }
}

/** One revealed tile's ground: rock from the autotile, or floor and any gate. */
function drawGround(
  ctx: Ctx,
  sheets: DeepReadonly<Sheets>,
  maze: DeepReadonly<MazeState>,
  tx: number,
  ty: number,
  x: number,
  y: number,
): void {
  const trench = sheets.trench;
  if (isRock(maze, tx, ty)) {
    if (
      drawFrame(ctx, trench, wallMask(maze, tx, ty), x + HALF, y + HALF, TILE)
    ) {
      return;
    }
    ctx.fillStyle = COLOR.rock;
    ctx.fillRect(x, y, TILE, TILE);
    ctx.strokeStyle = COLOR.rockRim;
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, TILE - 1, TILE - 1);
    return;
  }
  if (!drawFrame(ctx, trench, TRENCH_FLOOR, x + HALF, y + HALF, TILE)) {
    ctx.fillStyle = COLOR.floor;
    ctx.fillRect(x, y, TILE, TILE);
  }
  if (!isGate(maze, tx, ty)) return;
  if (drawFrame(ctx, trench, TRENCH_GATE, x + HALF, y + HALF, TILE)) return;
  ctx.strokeStyle = COLOR.gate;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(x + 3, y + HALF);
  ctx.lineTo(x + TILE - 3, y + HALF);
  ctx.stroke();
}

/**
 * The forager's own glow: a cool pocket of light that fills the vision circle it
 * carries, so the window widens visibly as the forager brightens
 * (`specs/sensing.md`).
 *
 * The glow does not fade out before the edge. It holds a third of its strength
 * all the way to `R` and the mask below cuts it there, which is what makes the
 * window read as one lit disc with a clean rim rather than as a haze that peters
 * out somewhere short of it.
 */
function drawLightPocket(state: State, ctx: Ctx): void {
  const { x, y } = state.forager;
  const radius = windowRadius(state.brightness);
  const strength = 0.14 + 0.22 * state.brightness;
  const glow = ctx.createRadialGradient(x, y, 0, x, y, radius);
  glow.addColorStop(0, `rgba(${COLOR.foragerGlow},${strength})`);
  glow.addColorStop(0.55, `rgba(${COLOR.foragerGlow},${strength * 0.6})`);
  glow.addColorStop(1, `rgba(${COLOR.foragerGlow},${strength * 0.35})`);
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** A plankton reads as a small point of light on the corridor floor it sits on. */
function drawPlankton(state: State, ctx: Ctx): void {
  ctx.save();
  ctx.fillStyle = COLOR.plankton;
  for (let ty = 0; ty < GRID_ROWS; ty++) {
    for (let tx = 0; tx < GRID_COLS; tx++) {
      const index = tileIndex(tx, ty);
      if (!state.plankton[index] || !state.revealed[index]) continue;
      const lit = state.lit[index];
      ctx.globalAlpha = lit ? 1 : 0.4;
      ctx.shadowColor = lit ? "rgba(184,245,200,0.85)" : "rgba(0,0,0,0)";
      ctx.shadowBlur = lit ? 8 : 0;
      ctx.beginPath();
      ctx.arc(centerX(tx), centerY(ty), PLANKTON_DOT / 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

/**
 * An ink cloud: visibly darker than the water it stands in, and cut to the
 * vision circle, because a cloud is part of the maze the forager is looking at
 * rather than one of the three things that show over the blackout.
 */
function drawInk(state: State, ctx: Ctx): void {
  const forager = state.forager;
  ctx.save();
  ctx.beginPath();
  ctx.arc(forager.x, forager.y, windowRadius(state.brightness), 0, Math.PI * 2);
  ctx.clip();
  for (const cloud of state.inkClouds) {
    const alpha = Math.min(1, cloud.remaining) * 0.9;
    const fill = ctx.createRadialGradient(
      cloud.x,
      cloud.y,
      0,
      cloud.x,
      cloud.y,
      cloud.radius,
    );
    fill.addColorStop(0, `rgba(${COLOR.ink},${alpha})`);
    fill.addColorStop(0.65, `rgba(${COLOR.ink},${alpha})`);
    fill.addColorStop(0.88, `rgba(${COLOR.ink},${alpha * 0.7})`);
    fill.addColorStop(1, `rgba(${COLOR.ink},0)`);
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.arc(cloud.x, cloud.y, cloud.radius, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// ---- The wavefronts ------------------------------------------------------

/**
 * The heading the front is traveling in as it passes `tile`, taken from the
 * bucket it arrived from, so a crest bends at a bend and turns back off rock
 * exactly as the flood does. The origin has no heading and opens as a ring.
 */
function crestHeading(
  pulse: DeepReadonly<PulseState>,
  distance: number,
  tile: DeepReadonly<Tile>,
): { readonly x: number; readonly y: number } {
  if (distance === 0) return { x: 0, y: 0 };
  for (const from of pulse.buckets[distance - 1]) {
    let dx = tile.tx - from.tx;
    const dy = tile.ty - from.ty;
    // The two mouths of the wrap tunnel are neighbors, so a step across the
    // border is one step rather than the width of the grid.
    if (dx === GRID_COLS - 1) dx = -1;
    else if (dx === -(GRID_COLS - 1)) dx = 1;
    if (Math.abs(dx) + Math.abs(dy) === 1) return { x: dx, y: dy };
  }
  return { x: 0, y: 0 };
}

/**
 * Every wavefront in flight, drawn as a glowing crest that flows outward through
 * the corridors rather than as an expanding circle (`specs/sensing.md`). Each
 * tile the front has just passed carries a short arc bulging the way the sound is
 * traveling, brightest at the leading edge and fading behind it.
 */
function drawPulses(state: State, ctx: Ctx): void {
  if (state.pulses.length === 0) return;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.lineCap = "round";
  const strokes = [
    { width: TILE * 0.42, peak: 0.16 },
    { width: TILE * 0.16, peak: 0.7 },
  ];
  for (const pulse of state.pulses) {
    const rgb = SONAR_RGB[pulse.tint];
    for (const stroke of strokes) {
      ctx.lineWidth = stroke.width;
      for (let d = 0; d < pulse.buckets.length; d++) {
        const behind = pulse.front - d;
        if (behind < 0 || behind > SONAR_BAND) continue;
        const alpha = (1 - behind / SONAR_BAND) * stroke.peak;
        ctx.strokeStyle = `rgba(${rgb},${alpha})`;
        for (const tile of pulse.buckets[d]) {
          drawCrest(ctx, pulse, d, tile);
        }
      }
    }
  }
  ctx.restore();
}

function drawCrest(
  ctx: Ctx,
  pulse: DeepReadonly<PulseState>,
  distance: number,
  tile: DeepReadonly<Tile>,
): void {
  const x = centerX(tile.tx);
  const y = centerY(tile.ty);
  const heading = crestHeading(pulse, distance, tile);
  ctx.beginPath();
  if (heading.x === 0 && heading.y === 0) {
    ctx.arc(x, y, SONAR_ARC_R, 0, Math.PI * 2);
  } else {
    // The arc is centered behind the tile so the crest bulges the way it travels.
    const theta = Math.atan2(heading.y, heading.x);
    ctx.arc(
      x - SONAR_ARC_R * heading.x,
      y - SONAR_ARC_R * heading.y,
      SONAR_ARC_R,
      theta - SONAR_ARC_SPREAD,
      theta + SONAR_ARC_SPREAD,
    );
  }
  ctx.stroke();
}

// ---- The flare and the alerts -------------------------------------------

/**
 * Which bloom frame a Flarefish is on, how large it is drawn, and how strongly.
 *
 * The three beats are the ones `specs/assets.md` lays out: the charge-up swells
 * toward a white core, the bloom is widest and brightest at frame `5` — scaled so
 * its lit radius is `FLARE_RADIUS` — and the fade collapses and dims after the
 * flare is already over.
 */
function bloomBeat(p: DeepReadonly<PredatorState>): {
  readonly frame: number;
  readonly scale: number;
  readonly alpha: number;
} | null {
  const phase = p.flarePhase;
  if (phase !== null) {
    if (phase < FLARE_CHARGE) {
      const u = phase / FLARE_CHARGE;
      return {
        frame: Math.min(2, Math.floor(u * 3)),
        scale: 0.5 + 0.4 * u,
        alpha: 0.35 + 0.45 * u,
      };
    }
    const u = (phase - FLARE_CHARGE) / FLARE_BLOOM;
    return { frame: 3 + Math.min(2, Math.floor(u * 3)), scale: 1, alpha: 1 };
  }
  if (p.flareFadeIn > 0) {
    const u = 1 - p.flareFadeIn / FLARE_FADE;
    return {
      frame: 6 + Math.min(1, Math.floor(u * 2)),
      scale: 1 - 0.3 * u,
      alpha: 1 - u,
    };
  }
  return null;
}

/**
 * Every flare, drawn from the bloom sheet as its own overlay centered on the
 * Flarefish and scaled so frame `5`'s lit radius is `FLARE_RADIUS`.
 */
function drawBlooms(state: State, ctx: Ctx): void {
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (const p of state.predators) {
    if (p.kind !== "flarefish" || p.mode === "den") continue;
    const beat = bloomBeat(p);
    if (beat === null) continue;
    const size = FLARE_RADIUS * 2 * beat.scale;
    ctx.globalAlpha = beat.alpha;
    if (drawFrame(ctx, state.sheets.flareBloom, beat.frame, p.x, p.y, size)) {
      continue;
    }
    const glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, size / 2);
    glow.addColorStop(0, "rgba(255,236,200,0.9)");
    glow.addColorStop(0.4, "rgba(255,138,76,0.45)");
    glow.addColorStop(1, "rgba(255,138,76,0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(p.x, p.y, size / 2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/**
 * The pre-bloom charge-up tell: a small white-hot point on the Flarefish while
 * its charge-up glow builds, drawn through the fog so it gives its position away
 * wherever it stands (`specs/predators/flarefish.md`). It shows during the
 * charge-up alone, because outside a flare the Flarefish gives off nothing.
 */
function drawFlareTells(state: State, ctx: Ctx): void {
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (const p of state.predators) {
    if (p.mode === "den" || p.flarePhase === null) continue;
    if (p.flarePhase >= FLARE_CHARGE) continue;
    const swell = p.flarePhase / FLARE_CHARGE;
    const radius = 6 + 10 * swell;
    const glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, radius);
    glow.addColorStop(0, `rgba(255,246,224,${0.5 + 0.45 * swell})`);
    glow.addColorStop(1, "rgba(255,138,76,0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/**
 * The detection alert: a sharp flash burst in the hunter's own color, snapping
 * outward and fading over the window (`specs/predators.md`).
 */
function drawAlerts(state: State, ctx: Ctx): void {
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (const p of state.predators) {
    if (p.alertIn <= 0) continue;
    const spent = 1 - p.alertIn / ALERT_TIME;
    const fade = p.alertIn / ALERT_TIME;
    const color = p.kind === "gloamfin" ? COLOR.gloamfin : COLOR.flarefish;
    ctx.globalAlpha = fade * 0.9;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 6 + 4 * fade, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = fade * 0.85;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.5 * fade + 1;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 10 + spent * 42, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

// ---- The creatures -------------------------------------------------------

/** The sheet and frame a predator's body is drawn from (`specs/assets.md`). */
function predatorFrame(
  state: State,
  p: DeepReadonly<PredatorState>,
): { readonly frames: Frames; readonly index: number } {
  const moving = p.heading !== null;
  switch (p.kind) {
    case "lanternjaw":
      // Hunting it shows its true body; wandering it wears the jellyfish
      // disguise, the same art the bonus drifter is drawn from.
      return {
        frames: state.sheets.lanternjaw,
        index:
          p.mode === "chase"
            ? swimFrame(p.facing, moving, state.simTime, HUNT_FPS)
            : 8 + swayFrame(state.simTime),
      };
    case "gloamfin":
      return {
        frames: state.sheets.gloamfin,
        index: swimFrame(p.facing, moving, state.simTime, SWAY_FPS),
      };
    case "flarefish":
      return {
        frames: state.sheets.flarefish,
        index: swimFrame(p.facing, moving, state.simTime, SWAY_FPS),
      };
  }
}

/** A body drawn in code, for a sheet frame that could not be loaded. */
function drawBodyFallback(ctx: Ctx, x: number, y: number, color: string): void {
  ctx.save();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(x, y, TILE * 0.34, TILE * 0.26, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawCreatures(state: State, ctx: Ctx): void {
  ctx.save();
  ctx.imageSmoothingEnabled = false;

  // A predator's body is drawn only while it is lit this instant, and between
  // those glimpses nothing of where it was is kept (`specs/sensing.md`).
  for (const p of state.predators) {
    if (p.mode === "den" || !p.lit) continue;
    const sprite = predatorFrame(state, p);
    if (drawFrame(ctx, sprite.frames, sprite.index, p.x, p.y, TILE)) continue;
    drawBodyFallback(
      ctx,
      p.x,
      p.y,
      p.kind === "gloamfin"
        ? COLOR.gloamfin
        : p.kind === "flarefish"
          ? COLOR.flarefish
          : COLOR.amberCore,
    );
  }

  // A drifter's jellyfish body is drawn only where it is lit, exactly as a
  // predator's is; its amber mote below is what shows it in the dark.
  for (const d of state.drifters) {
    if (!drifterLit(state.lit, d)) continue;
    if (
      drawFrame(
        ctx,
        state.sheets.drifter,
        swayFrame(state.simTime),
        d.x,
        d.y,
        TILE,
      )
    ) {
      continue;
    }
    drawBodyFallback(ctx, d.x, d.y, COLOR.amberCore);
  }

  const f = state.forager;
  const frame = swimFrame(
    f.facing,
    f.heading !== null,
    state.simTime,
    FORAGER_FPS,
  );
  if (!drawFrame(ctx, state.sheets.glimmerfin, frame, f.x, f.y, TILE)) {
    drawBodyFallback(ctx, f.x, f.y, COLOR.forager);
  }
  ctx.restore();
}

/**
 * The maze's two amber lights, drawn identically so one glimmer is not told from
 * the other: the bonus drifter, and every out-of-den Lanternjaw's bulb
 * (`specs/sensing.md`). Inside the vision circle each shows across unrevealed fog
 * and through rock, wherever the light pocket fails to reach.
 *
 * They are the one thing drawn after the mask that the circle still governs, so
 * they are cut to it on the path, exactly as the maze beneath them is: a glimmer
 * beyond `R` is not drawn at all, and the ground the mask painted there is what
 * shows instead. Closing on an amber light is what brings it into view, and it
 * still says nothing about which of the two it is.
 */
function drawAmberLights(state: State, ctx: Ctx): void {
  const { x, y } = state.forager;
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, windowRadius(state.brightness), 0, Math.PI * 2);
  ctx.clip();
  ctx.globalCompositeOperation = "lighter";
  for (const d of state.drifters) drawAmberOrb(ctx, d.x, d.y);
  for (const p of state.predators) {
    if (p.kind === "lanternjaw" && p.mode !== "den")
      drawAmberOrb(ctx, p.x, p.y);
  }
  ctx.restore();
}

function drawAmberOrb(ctx: Ctx, x: number, y: number): void {
  const glow = ctx.createRadialGradient(x, y, 0, x, y, 14);
  glow.addColorStop(0, "rgba(255,240,194,0.95)");
  glow.addColorStop(0.45, `rgba(${COLOR.amber},0.55)`);
  glow.addColorStop(1, `rgba(${COLOR.amber},0)`);
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

function pad(value: number, width: number): string {
  const digits = String(Math.max(0, Math.floor(value)));
  return digits.padStart(width, "0");
}

/**
 * The HUD, on the strips above and below the maze region so it leaves the maze
 * itself clear. It stands outside the fog of war entirely (`specs/ui.md`).
 */
function drawHud(state: State, ctx: Ctx): void {
  ctx.save();
  ctx.textBaseline = "alphabetic";

  ctx.textAlign = "left";
  ctx.fillStyle = COLOR.text;
  ctx.font = `700 ${SCORE_FONT_PX}px ${MONO}`;
  ctx.fillText(pad(state.score, SCORE_DIGITS), HUD_MARGIN, 60);

  ctx.textAlign = "right";
  ctx.font = `16px ${MONO}`;
  ctx.fillStyle = COLOR.textFaint;
  ctx.fillText(DIVE_LABEL, STAGE_W - HUD_MARGIN, 46);

  // The lives in reserve, as that many small forager icons.
  ctx.imageSmoothingEnabled = false;
  for (let i = 0; i < state.lives; i++) {
    const x = HUD_MARGIN + i * LIVES_GAP + LIVES_ICON / 2;
    const y = HUD_BOT_Y + 30;
    if (!drawFrame(ctx, state.sheets.glimmerfin, 6, x, y, LIVES_ICON)) {
      drawBodyFallback(ctx, x, y, COLOR.forager);
    }
  }
  ctx.imageSmoothingEnabled = true;

  ctx.textAlign = "right";
  ctx.font = `18px ${MONO}`;
  ctx.fillStyle = COLOR.textDim;
  ctx.fillText(`DEPTH ${state.depth}`, STAGE_W - HUD_MARGIN, HUD_BOT_Y + 36);

  drawGauge(
    ctx,
    SONAR_GAUGE_X,
    HUD_BOT_Y + 28,
    "SONAR",
    1 - state.sonarCooldown / SONAR_COOLDOWN,
    COLOR.forager,
  );
  drawGauge(
    ctx,
    INK_GAUGE_X,
    HUD_BOT_Y + 28,
    "INK",
    1 - state.inkCooldown / INK_COOLDOWN,
    COLOR.gloamfin,
  );
  ctx.restore();
}

/** A readiness gauge: full while ready, filling back up as its cooldown runs. */
function drawGauge(
  ctx: Ctx,
  x: number,
  y: number,
  label: string,
  filled: number,
  color: string,
): void {
  ctx.save();
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.font = `13px ${MONO}`;
  ctx.fillStyle = COLOR.textFaint;
  ctx.fillText(label, x, y);
  const barX = x + ctx.measureText(label).width + 16;
  ctx.fillStyle = "rgba(143,166,184,0.16)";
  ctx.fillRect(barX, y - 3, GAUGE_W, 6);
  ctx.fillStyle = color;
  ctx.fillRect(barX, y - 3, GAUGE_W * Math.max(0, Math.min(1, filled)), 6);
  ctx.restore();
}

// ---- The screens ---------------------------------------------------------

function overlay(ctx: Ctx, alpha: number): void {
  ctx.fillStyle = `rgba(2,4,8,${alpha})`;
  ctx.fillRect(0, 0, STAGE_W, STAGE_H);
}

function panel(ctx: Ctx, height: number): void {
  const width = 560;
  const x = STAGE_W / 2 - width / 2;
  const y = STAGE_H / 2 - height / 2;
  ctx.fillStyle = COLOR.panel;
  ctx.fillRect(x, y, width, height);
  ctx.strokeStyle = COLOR.panelBorder;
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, width - 1, height - 1);
}

/**
 * A menu: its items stacked in order, with the selected one drawn distinctly so a
 * player always sees which item `confirm` would take (`specs/ui.md`).
 */
function drawMenu(
  ctx: Ctx,
  screen: Screen,
  items: readonly string[],
  selected: number,
): void {
  ctx.textAlign = "center";
  ctx.font = `28px ${MONO}`;
  items.forEach((item, index) => {
    const y = itemBaseline(screen, index);
    if (index === selected) {
      ctx.fillStyle = COLOR.text;
      ctx.fillText(`> ${item} <`, STAGE_W / 2, y);
    } else {
      ctx.fillStyle = COLOR.textDim;
      ctx.fillText(item, STAGE_W / 2, y);
    }
  });
}

/** A dim slice of trench behind the title, for atmosphere. */
function drawBackdrop(state: State, ctx: Ctx): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(GRID_ORIGIN_X, GRID_ORIGIN_Y, MAZE_W, MAZE_H);
  ctx.clip();
  ctx.imageSmoothingEnabled = false;
  ctx.globalAlpha = 0.14;
  for (let ty = 0; ty < GRID_ROWS; ty++) {
    for (let tx = 0; tx < GRID_COLS; tx++) {
      drawGround(
        ctx,
        state.sheets,
        state.maze,
        tx,
        ty,
        GRID_ORIGIN_X + tx * TILE,
        GRID_ORIGIN_Y + ty * TILE,
      );
    }
  }
  ctx.restore();
}

function drawTitle(state: State, ctx: Ctx): void {
  drawBackdrop(state, ctx);
  ctx.save();
  ctx.textAlign = "center";
  ctx.fillStyle = COLOR.forager;
  ctx.font = `700 118px ${MONO}`;
  ctx.shadowColor = `rgba(${COLOR.foragerGlow},0.5)`;
  ctx.shadowBlur = 28;
  ctx.fillText(TITLE_TEXT, STAGE_W / 2, 252);
  ctx.shadowBlur = 0;
  ctx.font = `22px ${MONO}`;
  ctx.fillStyle = COLOR.textDim;
  ctx.fillText(TAGLINE_TEXT, STAGE_W / 2, 300);
  drawMenu(ctx, "title", TITLE_ITEMS, state.menuIndex);
  ctx.font = `16px ${MONO}`;
  ctx.fillStyle = COLOR.textFaint;
  ctx.fillText("UP / DOWN  MOVE     ENTER  SELECT", STAGE_W / 2, STAGE_H - 48);
  ctx.restore();
}

/** How to play, in a player's words rather than as rules of a system. */
const HOWTO_LINES: readonly (readonly [string, string])[] = [
  ["MOVE", "Arrow keys, or W A S D"],
  ["SONAR", "Space  -  floods the corridors ahead, but the dark hears it"],
  ["INK", "Shift  -  blinds the hunters that see, not the one that listens"],
  ["PAUSE", "Esc or P     MUTE  M"],
  ["", ""],
  ["THE LANTERNJAW", "follows your light. Go dim, or ink it"],
  [
    "THE GLOAMFIN",
    "follows your sound. It is faster, so break its fix at a corner",
  ],
  [
    "THE FLAREFISH",
    "shows nothing until it flares. Leave the light, or ink it",
  ],
  ["", ""],
  ["An amber glimmer is a harmless drifter, or it is not.", ""],
  ["Your light shows what is straight ahead; sonar bends round corners.", ""],
  [
    "You see the trench only inside the circle you carry. Eating widens it.",
    "",
  ],
  ["Graze every plankton to descend. Contact costs a life.", ""],
];

function drawHowTo(ctx: Ctx): void {
  ctx.save();
  ctx.fillStyle = COLOR.bg;
  ctx.fillRect(0, 0, STAGE_W, STAGE_H);
  ctx.textAlign = "center";
  ctx.fillStyle = COLOR.forager;
  ctx.font = `700 48px ${MONO}`;
  ctx.fillText("HOW TO PLAY", STAGE_W / 2, 116);

  const keyRight = STAGE_W / 2 - 230;
  const valueLeft = STAGE_W / 2 - 210;
  let y = 196;
  ctx.font = `19px ${MONO}`;
  for (const [key, value] of HOWTO_LINES) {
    if (key === "" && value === "") {
      y += 16;
      continue;
    }
    if (value === "") {
      ctx.textAlign = "center";
      ctx.fillStyle = COLOR.text;
      ctx.fillText(key, STAGE_W / 2, y);
    } else {
      ctx.textAlign = "right";
      ctx.fillStyle = COLOR.forager;
      ctx.fillText(key, keyRight, y);
      ctx.textAlign = "left";
      ctx.fillStyle = COLOR.textDim;
      ctx.fillText(value, valueLeft, y);
    }
    y += 38;
  }
  ctx.textAlign = "center";
  ctx.font = `16px ${MONO}`;
  ctx.fillStyle = COLOR.textFaint;
  ctx.fillText("ENTER OR ESC  BACK", STAGE_W / 2, STAGE_H - 48);
  ctx.restore();
}

function drawCountdown(state: State, ctx: Ctx): void {
  const beat = Math.max(1, Math.ceil(state.screenIn / COUNTDOWN_BEAT));
  ctx.save();
  ctx.textAlign = "center";
  ctx.fillStyle = COLOR.forager;
  ctx.shadowColor = `rgba(${COLOR.foragerGlow},0.6)`;
  ctx.shadowBlur = 24;
  ctx.font = `700 40px ${MONO}`;
  ctx.fillText("DIVE", STAGE_W / 2, STAGE_H / 2 - 30);
  ctx.font = `700 96px ${MONO}`;
  ctx.fillText(String(beat), STAGE_W / 2, STAGE_H / 2 + 60);
  ctx.restore();
}

function drawPaused(state: State, ctx: Ctx): void {
  overlay(ctx, 0.78);
  panel(ctx, 340);
  ctx.save();
  ctx.textAlign = "center";
  ctx.fillStyle = COLOR.textDim;
  ctx.font = `18px ${MONO}`;
  ctx.fillText("HOLD FAST", STAGE_W / 2, STAGE_H / 2 - 110);
  ctx.fillStyle = COLOR.forager;
  ctx.font = `700 48px ${MONO}`;
  ctx.fillText("PAUSED", STAGE_W / 2, STAGE_H / 2 - 56);
  drawMenu(ctx, "paused", PAUSE_ITEMS, state.menuIndex);
  ctx.restore();
}

function drawCleared(state: State, ctx: Ctx): void {
  overlay(ctx, 0.6);
  ctx.save();
  ctx.textAlign = "center";
  ctx.fillStyle = COLOR.forager;
  ctx.shadowColor = `rgba(${COLOR.foragerGlow},0.5)`;
  ctx.shadowBlur = 28;
  ctx.font = `700 58px ${MONO}`;
  ctx.fillText(`DEPTH ${state.depth} CLEARED`, STAGE_W / 2, STAGE_H / 2);
  ctx.shadowBlur = 0;
  ctx.font = `20px ${MONO}`;
  ctx.fillStyle = COLOR.textDim;
  ctx.fillText("DESCENDING", STAGE_W / 2, STAGE_H / 2 + 50);
  ctx.restore();
}

function drawGameOver(state: State, ctx: Ctx): void {
  ctx.fillStyle = COLOR.bg;
  ctx.fillRect(0, 0, STAGE_W, STAGE_H);
  overlay(ctx, 0.64);
  panel(ctx, 400);
  ctx.save();
  ctx.textAlign = "center";
  ctx.fillStyle = COLOR.textDim;
  ctx.font = `18px ${MONO}`;
  ctx.fillText("LOST IN THE DARK", STAGE_W / 2, STAGE_H / 2 - 132);
  ctx.fillStyle = COLOR.forager;
  ctx.font = `700 48px ${MONO}`;
  ctx.fillText("GAME OVER", STAGE_W / 2, STAGE_H / 2 - 78);
  ctx.fillStyle = COLOR.text;
  ctx.font = `34px ${MONO}`;
  ctx.fillText(
    `SCORE ${pad(state.score, SCORE_DIGITS)}`,
    STAGE_W / 2,
    STAGE_H / 2 - 26,
  );
  ctx.fillStyle = COLOR.textDim;
  ctx.font = `20px ${MONO}`;
  ctx.fillText(`REACHED DEPTH ${state.depth}`, STAGE_W / 2, STAGE_H / 2 + 10);
  drawMenu(ctx, "gameover", GAMEOVER_ITEMS, state.menuIndex);
  ctx.restore();
}
