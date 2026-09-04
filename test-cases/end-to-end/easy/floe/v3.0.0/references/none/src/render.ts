// Floe — drawing the state the ticks left behind.
//
// Nothing here writes to the state, and nothing the simulation does reads
// anything written here: the dependency runs one way (specs/instrumentation.md),
// which is what lets a posed scenario be drawn exactly as it was stepped.
//
// THE PICTURE IS DRAWN BETWEEN TWO TICKS. The simulation runs at a fixed 120 Hz
// and a frame is presented when the display asks for it, so every moving body is
// drawn at `prev + (now - prev) * alpha`, `alpha` being the fraction of the next
// tick the runtime has already accumulated. The `prev` fields are written by the
// tick and read only here.
//
// The context arrives cleared to the background and carrying the stage transform,
// so everything below is in stage units (specs/overview.md).

import {
  BAY_COUNT,
  HUD_H,
  HUD_LEVEL_LABEL,
  ICE_BOTTOM,
  ICE_TOP,
  ROW_BAYS,
  ROW_CAP,
  ROW_MEDIAN,
  ROW_NEAR,
  SPRITE_TILE,
  STAGE_H,
  STAGE_W,
  STRAIT_H,
  STRAIT_TOP,
  TAGLINE_TEXT,
  TILE,
  TITLE_TEXT,
  TOTAL_LEVELS,
  WATER_BOTTOM,
  WATER_TOP,
  tileLeft,
  tileTop,
} from "./constants";
import {
  BEAR_LUNGE_BASE,
  BEAR_SWIM_BASE,
  facingPair,
  floeArt,
  vehicleArt,
  type Art,
} from "./assets";
import { bayColumns, bayCenterX } from "./grid";
import { laneAt } from "./lanes";
import { menuBaseline, menuLayout } from "./menus";
import { bearSwimming } from "./entities";
import {
  BEAR_LUNGE_FPS,
  BEAR_RUN_FPS,
  BEAR_SWIM_FPS,
  COLOR,
  CROSSER_FPS,
  HUD,
  MONO_FONT,
  UI_FONT,
} from "./theme";
import type { Bear, FloeState, LaneItem, Screen, VehicleKind } from "./types";

/** Where a value that moved from `prev` to `now` stands `alpha` into the next tick. */
function lerp(prev: number, now: number, alpha: number): number {
  return prev + (now - prev) * alpha;
}

/** Which frame of a two-frame pair is showing at this moment of game time. */
function beat(time: number, fps: number): number {
  return Math.floor(time * fps) % 2;
}

/** Draw the whole stage: the HUD, the strait, and whatever screen is in front. */
export function render(
  state: FloeState,
  art: Art,
  ctx: CanvasRenderingContext2D,
  alpha: number,
): void {
  // Pixel art stays pixel art at every scale the stage is fitted to
  // (specs/assets.md).
  ctx.imageSmoothingEnabled = false;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";

  drawStrait(state, art, ctx, alpha);
  drawHud(state, ctx);
  drawScreen(state, ctx);
}

// ---- The strait ----------------------------------------------------------

/** Everything below the HUD bar, clipped so nothing reaches into it. */
function drawStrait(
  state: FloeState,
  art: Art,
  ctx: CanvasRenderingContext2D,
  alpha: number,
): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, STRAIT_TOP, STAGE_W, STRAIT_H);
  ctx.clip();

  drawBands(ctx);
  drawBays(state, ctx);
  drawFish(state, ctx);
  for (const floe of state.floes) drawFloe(floe, art, ctx, alpha);
  for (const vehicle of state.vehicles)
    drawVehicle(state, vehicle, art, ctx, alpha);
  drawCritter(state, art, ctx, alpha);
  for (const bear of state.bears) drawBear(state, bear, art, ctx, alpha);
  drawEffects(state, art, ctx);

  ctx.restore();
}

/** A row band, as a stage rectangle. */
function bandRect(
  fromRow: number,
  toRow: number,
): [number, number, number, number] {
  const top = tileTop(fromRow);
  return [0, top, STAGE_W, tileTop(toRow + 1) - top];
}

/** The five bands, each a flat tint far from every other (specs/overview.md). */
function drawBands(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = COLOR.water;
  ctx.fillRect(...bandRect(WATER_TOP, WATER_BOTTOM));
  // A slightly deeper tint down the middle of each water row, so the drift reads
  // as water rather than as a flat panel.
  ctx.fillStyle = COLOR.waterDeep;
  for (let row = WATER_TOP; row <= WATER_BOTTOM; row += 1) {
    ctx.fillRect(0, tileTop(row) + TILE - 3, STAGE_W, 3);
  }

  ctx.fillStyle = COLOR.farShore;
  ctx.fillRect(...bandRect(ROW_CAP, ROW_BAYS));
  ctx.fillStyle = COLOR.farShoreEdge;
  ctx.fillRect(0, tileTop(ROW_BAYS + 1) - 3, STAGE_W, 3);

  ctx.fillStyle = COLOR.median;
  ctx.fillRect(...bandRect(ROW_MEDIAN, ROW_MEDIAN));

  ctx.fillStyle = COLOR.iceBand;
  ctx.fillRect(...bandRect(ICE_TOP, ICE_BOTTOM));
  ctx.fillStyle = COLOR.iceBandLine;
  for (let row = ICE_TOP; row <= ICE_BOTTOM; row += 1) {
    ctx.fillRect(0, tileTop(row), STAGE_W, 1);
  }

  ctx.fillStyle = COLOR.nearShore;
  ctx.fillRect(...bandRect(ROW_NEAR, ROW_NEAR));
}

/** The five bays cut into the far shore, open or filled (specs/bays.md). */
function drawBays(state: FloeState, ctx: CanvasRenderingContext2D): void {
  for (let bay = 0; bay < BAY_COUNT; bay += 1) {
    const [left] = bayColumns(bay);
    const x = tileLeft(left);
    const y = tileTop(ROW_BAYS);
    ctx.fillStyle = state.bays[bay] ? COLOR.bayFilled : COLOR.bayOpen;
    ctx.fillRect(x, y, TILE * 2, TILE);
    if (!state.bays[bay]) continue;
    // A filled bay reads as packed rather than open: two blocks of shore ice set
    // into the gold.
    ctx.fillStyle = COLOR.farShore;
    ctx.fillRect(x + 6, y + 8, TILE - 6, TILE - 16);
    ctx.fillRect(x + TILE + 2, y + 8, TILE - 6, TILE - 16);
  }
}

/** The bonus catch, drawn in code (specs/assets.md). */
function drawFish(state: FloeState, ctx: CanvasRenderingContext2D): void {
  if (state.fishBay === null) return;
  const cx = bayCenterX(state.fishBay);
  const cy = tileTop(ROW_BAYS) + TILE / 2;
  ctx.fillStyle = COLOR.fish;
  ctx.beginPath();
  ctx.ellipse(cx, cy, 11, 6, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(cx + 9, cy);
  ctx.lineTo(cx + 17, cy - 6);
  ctx.lineTo(cx + 17, cy + 6);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = COLOR.water;
  ctx.fillRect(cx - 6, cy - 2, 3, 3);
}

/** One floe, from its own frame, over every tile it spans (specs/assets.md). */
function drawFloe(
  floe: LaneItem,
  art: Art,
  ctx: CanvasRenderingContext2D,
  alpha: number,
): void {
  const { image, sourceW } = floeArt(
    art,
    floe.kind as "pan" | "raft3" | "raft4",
  );
  const x = lerp(floe.prevX, floe.x, alpha);
  ctx.drawImage(
    image,
    0,
    0,
    sourceW,
    SPRITE_TILE,
    x,
    tileTop(floe.row),
    TILE * floe.len,
    TILE,
  );
}

/**
 * One vehicle, from its own frame, mirrored where its lane runs leftward.
 *
 * Each vehicle's art faces right, so a lane whose `dir` is `-1` draws it flipped
 * about its own middle and every vehicle faces the way its lane runs
 * (specs/assets.md).
 */
function drawVehicle(
  state: FloeState,
  vehicle: LaneItem,
  art: Art,
  ctx: CanvasRenderingContext2D,
  alpha: number,
): void {
  const frames = vehicleArt(art, vehicle.kind as VehicleKind);
  const x = lerp(vehicle.prevX, vehicle.x, alpha);
  const y = tileTop(vehicle.row);
  const width = TILE * vehicle.len;
  const lane = laneAt(state, vehicle.row);
  if (lane !== null && lane.dir === -1) {
    ctx.save();
    ctx.translate(x + width, y);
    ctx.scale(-1, 1);
    ctx.drawImage(frames[0], 0, 0, width, TILE);
    ctx.restore();
    return;
  }
  ctx.drawImage(frames[0], x, y, width, TILE);
}

/** The critter, from the pair for its facing, centered on its own center. */
function drawCritter(
  state: FloeState,
  art: Art,
  ctx: CanvasRenderingContext2D,
  alpha: number,
): void {
  const critter = state.critter;
  if (!critter.present) return;
  const frame =
    art.crosser[facingPair(critter.facing) + beat(state.simTime, CROSSER_FPS)];
  const x = lerp(critter.prevX, critter.x, alpha);
  const y = lerp(critter.prevY, critter.y, alpha);
  ctx.drawImage(frame, x - TILE / 2, y - TILE / 2, TILE, TILE);
}

/**
 * One bear: the run pair for its facing on ice, and the submerged swim pair over
 * open water (specs/assets.md).
 *
 * The swim frames already carry the silhouette and its wake, and a bear is drawn
 * after the floes, so one passing beneath a raft stays trackable. The LUNGE is
 * not here: every bear leaves the strait on the tick it catches the critter
 * (specs/hunter.md), so the lunge is drawn from the effect that catch left
 * behind, below.
 */
function drawBear(
  state: FloeState,
  bear: Bear,
  art: Art,
  ctx: CanvasRenderingContext2D,
  alpha: number,
): void {
  const index = bearSwimming(state, bear)
    ? BEAR_SWIM_BASE +
      facingPair(bear.facing) +
      beat(state.simTime, BEAR_SWIM_FPS)
    : facingPair(bear.facing) + beat(state.simTime, BEAR_RUN_FPS);
  const x = lerp(bear.prevX, bear.x, alpha);
  const y = lerp(bear.prevY, bear.y, alpha);
  ctx.drawImage(art.bear[index], x - TILE / 2, y - TILE / 2, TILE, TILE);
}

/**
 * What a lost life leaves behind: the splash of a fall and the spray of a crush,
 * both drawn in code, and the lunge of the bear that caught the critter, drawn
 * from the bear's own lunge pair where the two met (specs/assets.md).
 */
function drawEffects(
  state: FloeState,
  art: Art,
  ctx: CanvasRenderingContext2D,
): void {
  for (const effect of state.effects) {
    const life = Math.max(0, Math.min(1, effect.life / effect.span));
    if (effect.kind === "lunge") {
      const frame =
        art.bear[BEAR_LUNGE_BASE + beat(state.simTime, BEAR_LUNGE_FPS)];
      ctx.drawImage(
        frame,
        effect.x - TILE / 2,
        effect.y - TILE / 2,
        TILE,
        TILE,
      );
      continue;
    }
    ctx.globalAlpha = life;
    ctx.strokeStyle = effect.kind === "splash" ? COLOR.splash : COLOR.spray;
    ctx.lineWidth = 3;
    for (const ring of [0, 1]) {
      const radius = 6 + (1 - life) * (18 + ring * 10);
      ctx.beginPath();
      ctx.arc(effect.x, effect.y, radius, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
}

// ---- The HUD -------------------------------------------------------------

/** The five readouts specs/ui.md fixes, all inside the HUD bar. */
function drawHud(state: FloeState, ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = COLOR.panel;
  ctx.fillRect(0, 0, STAGE_W, HUD_H);
  ctx.fillStyle = COLOR.panelEdge;
  ctx.fillRect(0, HUD_H - 2, STAGE_W, 2);

  ctx.font = `700 ${HUD.fontPx}px ${MONO_FONT}`;
  ctx.fillStyle = COLOR.text;
  ctx.textAlign = "left";
  ctx.fillText(`SCORE ${state.score}`, HUD.scoreX, HUD.textY);
  ctx.fillText(`LIVES ${state.lives}`, HUD.livesX, HUD.textY);
  ctx.fillText(
    `${HUD_LEVEL_LABEL} ${state.level} / ${TOTAL_LEVELS}`,
    HUD.levelX,
    HUD.textY,
  );
  ctx.textAlign = "right";
  ctx.fillText(`TIME ${Math.ceil(state.timer)}`, HUD.timerX, HUD.textY);
  ctx.textAlign = "left";

  // The fifth readout: one mark per bay, each above that bay's own columns.
  for (let bay = 0; bay < BAY_COUNT; bay += 1) {
    const x = bayCenterX(bay) - HUD.bayW / 2;
    ctx.fillStyle = state.bays[bay] ? COLOR.bayFilled : COLOR.bayOpen;
    ctx.fillRect(x, HUD.bayY, HUD.bayW, HUD.bayH);
    ctx.strokeStyle = COLOR.textDim;
    ctx.lineWidth = 2;
    ctx.strokeRect(x, HUD.bayY, HUD.bayW, HUD.bayH);
  }
}

// ---- The screens ---------------------------------------------------------

/** A card the screens' text is set on, so every line is legible over the strait. */
function card(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  ctx.fillStyle = COLOR.panel;
  ctx.fillRect(x, y, width, height);
  ctx.strokeStyle = COLOR.panelEdge;
  ctx.lineWidth = 3;
  ctx.strokeRect(x, y, width, height);
}

/** One centered line. */
function line(
  ctx: CanvasRenderingContext2D,
  text: string,
  y: number,
  size: number,
  color: string,
  font = UI_FONT,
): void {
  ctx.textAlign = "center";
  ctx.font = `700 ${size}px ${font}`;
  ctx.fillStyle = color;
  ctx.fillText(text, STAGE_W / 2, y);
  ctx.textAlign = "left";
}

/**
 * A vertical menu, the highlighted item drawn distinctly (specs/ui.md).
 *
 * The baselines come from `src/menus.ts`, which is also what `menuItemRect`
 * reports its regions around, so a pointer aimed at a reported region lands on
 * the entry a player sees there.
 */
function menu(
  ctx: CanvasRenderingContext2D,
  screen: Screen,
  selected: number,
): void {
  const layout = menuLayout(screen);
  if (layout === null) return;
  layout.items.forEach((item, index) => {
    const chosen = index === selected;
    line(
      ctx,
      chosen ? `> ${item} <` : item,
      menuBaseline(layout, index),
      chosen ? 32 : 26,
      chosen ? COLOR.highlight : COLOR.textDim,
    );
  });
}

/** Whatever screen is in front of the player. */
function drawScreen(state: FloeState, ctx: CanvasRenderingContext2D): void {
  switch (state.screen) {
    case "title":
      veil(ctx);
      card(ctx, 340, 150, 600, 400);
      line(ctx, TITLE_TEXT, 268, 104, COLOR.text);
      line(ctx, TAGLINE_TEXT, 316, 26, COLOR.textDim);
      menu(ctx, "title", state.menuIndex);
      return;
    case "howto":
      veil(ctx);
      card(ctx, 180, 130, 920, 490);
      line(ctx, "HOW TO PLAY", 196, 46, COLOR.text);
      HOWTO_LINES.forEach((text, index) => {
        line(ctx, text, 260 + index * 44, 22, COLOR.textDim);
      });
      line(ctx, "PRESS ENTER OR ESCAPE TO GO BACK", 592, 20, COLOR.highlight);
      return;
    case "paused":
      veil(ctx);
      card(ctx, 420, 220, 440, 280);
      line(ctx, "PAUSED", 288, 46, COLOR.text);
      menu(ctx, "paused", state.menuIndex);
      return;
    case "victory":
      veil(ctx);
      card(ctx, 360, 170, 560, 380);
      line(ctx, "THE FAR SHORE", 234, 46, COLOR.highlight);
      line(ctx, `SCORE ${state.score}`, 292, 28, COLOR.text, MONO_FONT);
      line(
        ctx,
        `LEVELS CLEARED ${TOTAL_LEVELS}`,
        330,
        24,
        COLOR.textDim,
        MONO_FONT,
      );
      line(
        ctx,
        `LIVES REMAINING ${state.lives}`,
        366,
        24,
        COLOR.textDim,
        MONO_FONT,
      );
      menu(ctx, "victory", state.menuIndex);
      return;
    case "gameover":
      veil(ctx);
      card(ctx, 360, 170, 560, 380);
      line(ctx, "THE BEAR GOT YOU", 234, 46, COLOR.text);
      line(ctx, `SCORE ${state.score}`, 292, 28, COLOR.text, MONO_FONT);
      line(
        ctx,
        `LEVEL REACHED ${state.reachedLevel}`,
        336,
        24,
        COLOR.textDim,
        MONO_FONT,
      );
      menu(ctx, "gameover", state.menuIndex);
      return;
    default:
      return;
  }
}

/** Dim the strait behind a screen, so it shows as a slice rather than as play. */
function veil(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = "rgba(6, 16, 25, 0.74)";
  ctx.fillRect(0, STRAIT_TOP, STAGE_W, STAGE_H - STRAIT_TOP);
}

/** What the how-to screen covers (specs/ui.md). */
const HOWTO_LINES: readonly string[] = [
  "FILL ALL FIVE BAYS IN THE FAR SHORE TO CLEAR A LEVEL",
  "ARROW KEYS OR WASD HOP THE CRITTER ONE TILE AT A TIME",
  "A POLAR BEAR HUNTS YOU ACROSS THE WHOLE STRAIT",
  "PLOWS, DOGSLEDS AND CARS SLIDE ALONG THE ICE BAND",
  "FLOES DRIFT ALONG THE WATER BAND - RIDE THEM ACROSS",
  "EACH CROSSING IS UNDER A TIMER, SO KEEP MOVING",
];
