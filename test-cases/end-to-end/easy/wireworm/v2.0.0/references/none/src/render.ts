// Wireworm — drawing.
//
// Everything is drawn in the fixed 1280x720 logical space; the runtime installs
// the transform that maps it onto the canvas, so nothing here reads the canvas
// element or the window. The renderer changes nothing: it is handed the state
// the update left and draws it.
//
// THE SEEDED ART IS DRAWN AS THE SEEDED ART. Every node, worm segment, cursor
// and foe is one `drawImage` of a frame from `assets/` at its tile's size
// (specs/assets.md); the frames are never recolored, pre-composited, or blitted
// through a canvas of this build's own. What this build adds around them is the
// two-layer glow `src/theme.ts` explains — a halo behind and an additive core
// over — which is what makes the four charge states and the three foes read
// apart, since the art alone draws two of the charges with the same core pixels.
//
// The board, the band, the bolts, the arcs, the HUD, the banner, and every
// screen are drawn in code.

import {
  ARC_LIFE,
  BAND_TOP_Y,
  CHARGE_MAX,
  BOARD_H,
  BOARD_W,
  BOARD_Y,
  COLS,
  CORRUPTOR_FPS,
  ENDING_ITEMS,
  GLITCH_FPS,
  HUD_H,
  HUD_LEVEL_LABEL,
  NODE_PULSE_FPS,
  PAUSE_ITEMS,
  ROWS,
  STAGE_H,
  STAGE_W,
  TAGLINE_TEXT,
  TILE,
  TITLE_ITEMS,
  TITLE_TEXT,
  TOTAL_LEVELS,
  WORM_BODY_FPS,
  WORM_HEAD_FPS,
  tileCX,
  tileCY,
  tileLeft,
  tileTop,
} from "./constants";
import { WORM_PAIR, nodeFrame, type Sprites } from "./assets";
import { index } from "./field";
import {
  COLOR,
  CURSOR_GLOW,
  FOE_GLOW,
  HOWTO_HINT,
  HOWTO_LINES,
  HOWTO_TITLE,
  HUD_LABEL_PX,
  HUD_LABEL_Y,
  HUD_LEVEL_PX,
  HUD_MAX_PIPS,
  HUD_PAD_X,
  HUD_SCORE_PX,
  HUD_VALUE_Y,
  MONO,
  NODE_GLOW,
  NODE_PAD_INSET,
  TITLE_HINT,
  type Glow,
} from "./theme";
import type { Foe, WirewormState, Worm } from "./types";

type Ctx = CanvasRenderingContext2D;

/** Draw the whole frame. */
export function renderGame(
  state: WirewormState,
  ctx: Ctx,
  sprites: Sprites,
): void {
  ctx.imageSmoothingEnabled = false;
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";

  ctx.fillStyle = COLOR.bg;
  ctx.fillRect(0, 0, STAGE_W, STAGE_H);

  const onMenu = state.screen === "title" || state.screen === "howto";
  drawBoard(ctx, onMenu);

  if (onMenu) {
    drawFurniture(ctx, state, sprites);
    if (state.screen === "title") drawTitle(ctx, state);
    else drawHowTo(ctx);
    return;
  }

  // Everything play consists of is drawn inside the board's own region. The
  // clip is what makes that literal: a glow around a node on the entry row, or
  // around a foe leaving at the floor, reaches past the board's edge, and play
  // is confined to the board (specs/board.md).
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, BOARD_Y, BOARD_W, BOARD_H);
  ctx.clip();
  drawField(ctx, state, sprites);
  drawWorms(ctx, state, sprites);
  drawFoes(ctx, state, sprites);
  drawArcs(ctx, state);
  drawBolts(ctx, state);
  drawCursor(ctx, state, sprites);
  ctx.restore();

  drawHud(ctx, state);

  if (state.screen === "playing" && state.phase === "banner") {
    drawBanner(ctx, `${HUD_LEVEL_LABEL} ${state.level}`);
  }
  if (state.screen === "playing" && state.phase === "respawn") {
    drawBanner(ctx, "READY");
  }
  if (state.screen === "paused") drawPause(ctx, state);
  if (state.screen === "victory") drawVictory(ctx, state);
  if (state.screen === "gameover") drawGameOver(ctx, state);
}

// ---- The board -----------------------------------------------------------

/** The board, its trace grid, and the tinted player band along the floor. */
function drawBoard(ctx: Ctx, quiet: boolean): void {
  ctx.save();
  if (quiet) ctx.globalAlpha = 0.45;

  ctx.fillStyle = COLOR.board;
  ctx.fillRect(0, BOARD_Y, BOARD_W, BOARD_H);

  // The band reads as a distinct floor across the full width of the board.
  ctx.fillStyle = COLOR.band;
  ctx.fillRect(0, BAND_TOP_Y, BOARD_W, STAGE_H - BAND_TOP_Y);

  ctx.strokeStyle = COLOR.grid;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let c = 0; c <= COLS; c += 1) {
    const x = tileLeft(c) + 0.5;
    ctx.moveTo(x, BOARD_Y);
    ctx.lineTo(x, BOARD_Y + BOARD_H);
  }
  for (let r = 0; r <= ROWS; r += 1) {
    const y = tileTop(r) + 0.5;
    ctx.moveTo(0, y);
    ctx.lineTo(BOARD_W, y);
  }
  ctx.stroke();

  ctx.strokeStyle = COLOR.bandEdge;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, BAND_TOP_Y + 1);
  ctx.lineTo(BOARD_W, BAND_TOP_Y + 1);
  ctx.stroke();
  ctx.restore();
}

// ---- The glow layers -----------------------------------------------------

/** The halo a glow lays behind whatever it belongs to. */
function drawHalo(ctx: Ctx, cx: number, cy: number, glow: Glow): void {
  const [r, g, b] = glow.halo;
  const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, glow.haloRadius);
  gradient.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${glow.haloAlpha})`);
  gradient.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
  ctx.fillStyle = gradient;
  ctx.fillRect(
    cx - glow.haloRadius,
    cy - glow.haloRadius,
    glow.haloRadius * 2,
    glow.haloRadius * 2,
  );
}

/**
 * The core a glow adds over whatever it belongs to.
 *
 * Drawn additively, so it lifts the color at the center of the sprite rather
 * than hiding it — which is what separates two charge states the seeded art
 * draws with the same core pixels.
 */
function drawCore(ctx: Ctx, cx: number, cy: number, glow: Glow): void {
  const [r, g, b] = glow.core;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, glow.coreRadius);
  gradient.addColorStop(0, `rgba(${r}, ${g}, ${b}, 1)`);
  gradient.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
  ctx.fillStyle = gradient;
  ctx.fillRect(
    cx - glow.coreRadius,
    cy - glow.coreRadius,
    glow.coreRadius * 2,
    glow.coreRadius * 2,
  );
  ctx.restore();
}

/** The solder pad a node's component sits on, inset inside its own tile. */
function drawPad(
  ctx: Ctx,
  cx: number,
  cy: number,
  color: readonly [number, number, number],
  alpha: number,
): void {
  const [r, g, b] = color;
  ctx.save();
  ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;
  const size = TILE - NODE_PAD_INSET * 2;
  ctx.fillRect(cx - size / 2, cy - size / 2, size, size);
  ctx.restore();
}

/** One seeded frame, on a tile, optionally mirrored about its own center. */
function drawSprite(
  ctx: Ctx,
  image: CanvasImageSource,
  cx: number,
  cy: number,
  mirrored: boolean,
): void {
  if (!mirrored) {
    ctx.drawImage(image, cx - TILE / 2, cy - TILE / 2, TILE, TILE);
    return;
  }
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(-1, 1);
  ctx.drawImage(image, -TILE / 2, -TILE / 2, TILE, TILE);
  ctx.restore();
}

/** Which frame of a two-frame pair is showing, at `fps`. */
function pairFrame(simTime: number, fps: number): number {
  return Math.floor(simTime * fps) % 2;
}

/** Which frame of a looping sheet is showing, at `fps`. */
function loopFrame(simTime: number, fps: number, frames: number): number {
  return Math.floor(simTime * fps) % frames;
}

// ---- The node field ------------------------------------------------------

/** Every node on the board, at its charge. */
function drawField(ctx: Ctx, state: WirewormState, sprites: Sprites): void {
  // A critical node alternates the two critical frames, so it visibly pulses.
  const pulse = pairFrame(state.simTime, NODE_PULSE_FPS);
  for (let r = 0; r < ROWS; r += 1) {
    for (let c = 0; c < COLS; c += 1) {
      const charge = state.field[index(c, r)];
      if (charge < 0) continue;
      drawNode(ctx, sprites, c, r, charge, pulse);
    }
  }
}

/** One node: its charge halo, its seeded frame, and its charge core. */
export function drawNode(
  ctx: Ctx,
  sprites: Sprites,
  c: number,
  r: number,
  charge: number,
  pulse: number,
): void {
  const cx = tileCX(c);
  const cy = tileCY(r);
  const glow = NODE_GLOW[Math.max(0, Math.min(NODE_GLOW.length - 1, charge))];
  drawPad(ctx, cx, cy, glow.pad, glow.padAlpha);
  drawHalo(ctx, cx, cy, glow);
  // A critical node alternates frames 3 and 4; every other charge holds its own.
  const frame = charge >= CHARGE_MAX ? CHARGE_MAX + pulse : nodeFrame(charge);
  ctx.drawImage(sprites.node[frame], cx - TILE / 2, cy - TILE / 2, TILE, TILE);
  drawCore(ctx, cx, cy, glow);
}

// ---- The worms -----------------------------------------------------------

function drawWorms(ctx: Ctx, state: WirewormState, sprites: Sprites): void {
  for (const worm of state.worms) drawWorm(ctx, worm, sprites, state.simTime);
}

/**
 * One worm: the head from the head pair, the tail from the tail pair, and every
 * segment between them from the body pair.
 *
 * The art faces right, so a worm heading left draws every frame mirrored.
 */
export function drawWorm(
  ctx: Ctx,
  worm: Worm,
  sprites: Sprites,
  simTime: number,
): void {
  const mirrored = worm.dh < 0;
  const head = WORM_PAIR.head + pairFrame(simTime, WORM_HEAD_FPS);
  const rest = pairFrame(simTime, WORM_BODY_FPS);
  const last = worm.segments.length - 1;
  for (let i = 0; i < worm.segments.length; i += 1) {
    const segment = worm.segments[i];
    if (segment.c < 0 || segment.c >= COLS) continue;
    if (segment.r < 0 || segment.r >= ROWS) continue;
    const frame =
      i === 0
        ? head
        : i === last
          ? WORM_PAIR.tail + rest
          : WORM_PAIR.body + rest;
    drawSprite(
      ctx,
      sprites.worm[frame],
      tileCX(segment.c),
      tileCY(segment.r),
      mirrored,
    );
  }
}

// ---- The foes ------------------------------------------------------------

function drawFoes(ctx: Ctx, state: WirewormState, sprites: Sprites): void {
  for (const foe of state.foes) drawFoe(ctx, foe, sprites, state.simTime);
}

/** One foe: its signal halo, its seeded frame, and its signal core. */
export function drawFoe(
  ctx: Ctx,
  foe: Foe,
  sprites: Sprites,
  simTime: number,
): void {
  const glow = FOE_GLOW[foe.kind];
  drawHalo(ctx, foe.x, foe.y, glow);
  if (foe.kind === "glitch") {
    const frame = loopFrame(simTime, GLITCH_FPS, sprites.glitch.length);
    drawSprite(ctx, sprites.glitch[frame], foe.x, foe.y, false);
  } else if (foe.kind === "dropper") {
    drawSprite(ctx, sprites.dropper[0], foe.x, foe.y, false);
  } else {
    const frame = loopFrame(simTime, CORRUPTOR_FPS, sprites.corruptor.length);
    // The art faces right, so one crawling left is drawn mirrored.
    drawSprite(ctx, sprites.corruptor[frame], foe.x, foe.y, foe.vx < 0);
  }
  drawCore(ctx, foe.x, foe.y, glow);
}

// ---- The cursor and its bolts --------------------------------------------

/**
 * The cursor, drawn upright and never rotated.
 *
 * Spawn-in invulnerability is shown by pulsing the cursor's opacity rather than
 * by blinking it out: a cursor a player cannot see is a cursor they cannot aim,
 * and it stays drawn from the seeded frame throughout.
 */
function drawCursor(ctx: Ctx, state: WirewormState, sprites: Sprites): void {
  const cursor = state.cursor;
  ctx.save();
  if (cursor.invulnerable > 0) {
    ctx.globalAlpha = Math.floor(state.simTime * 12) % 2 === 0 ? 1 : 0.55;
  }
  drawHalo(ctx, cursor.x, cursor.y, CURSOR_GLOW);
  drawSprite(ctx, sprites.cursor[0], cursor.x, cursor.y, false);
  drawCore(ctx, cursor.x, cursor.y, CURSOR_GLOW);
  ctx.restore();
}

/** Every bolt in flight, as a bright capsule in the column it is climbing. */
function drawBolts(ctx: Ctx, state: WirewormState): void {
  if (state.bolts.length === 0) return;
  ctx.save();
  ctx.shadowColor = COLOR.boltGlow;
  ctx.shadowBlur = 10;
  ctx.fillStyle = COLOR.bolt;
  for (const bolt of state.bolts) {
    ctx.fillRect(bolt.x - 2, bolt.y - 9, 4, 18);
  }
  ctx.restore();
}

/** Every live arc, as the lightning fixed when it was created. */
function drawArcs(ctx: Ctx, state: WirewormState): void {
  if (state.arcs.length === 0) return;
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = COLOR.arc;
  ctx.shadowColor = COLOR.arcGlow;
  ctx.shadowBlur = 12;
  for (const arc of state.arcs) {
    ctx.globalAlpha = Math.min(1, (arc.life / ARC_LIFE) * 1.5);
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    arc.shape.forEach((point, at) => {
      if (at === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    });
    ctx.stroke();
  }
  ctx.restore();
}

// ---- The HUD -------------------------------------------------------------

/** The three readouts, all inside the HUD bar. */
function drawHud(ctx: Ctx, state: WirewormState): void {
  ctx.save();
  ctx.fillStyle = COLOR.hud;
  ctx.fillRect(0, 0, STAGE_W, HUD_H);
  ctx.fillStyle = COLOR.hudRule;
  ctx.fillRect(0, HUD_H - 2, STAGE_W, 2);

  label(ctx, "SCORE", HUD_PAD_X, HUD_LABEL_Y, "left");
  write(ctx, String(state.score), HUD_PAD_X, HUD_VALUE_Y, {
    size: HUD_SCORE_PX,
    weight: 700,
    color: COLOR.score,
    align: "left",
  });

  const livesX = 360;
  label(ctx, "LIVES", livesX, HUD_LABEL_Y, "left");
  const pips = Math.min(state.lives, HUD_MAX_PIPS);
  for (let i = 0; i < pips; i += 1) drawPip(ctx, livesX + i * 26, 40);
  write(ctx, String(state.lives), livesX + pips * 26 + 8, HUD_VALUE_Y - 4, {
    size: 18,
    weight: 700,
    color: COLOR.textDim,
    align: "left",
  });

  // One string, so the label, the level and the total read as one readout.
  write(
    ctx,
    `${HUD_LEVEL_LABEL} ${state.level} / ${TOTAL_LEVELS}`,
    STAGE_W - HUD_PAD_X,
    HUD_VALUE_Y,
    {
      size: HUD_LEVEL_PX,
      weight: 700,
      color: COLOR.text,
      align: "right",
    },
  );
  ctx.restore();
}

/** One life, drawn as the cutter's chevron. */
function drawPip(ctx: Ctx, x: number, y: number): void {
  ctx.save();
  ctx.fillStyle = COLOR.life;
  ctx.beginPath();
  ctx.moveTo(x + 9, y);
  ctx.lineTo(x + 18, y + 20);
  ctx.lineTo(x + 9, y + 15);
  ctx.lineTo(x, y + 20);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// ---- Screens -------------------------------------------------------------

/** A quiet decorative board behind the two menu screens. */
function drawFurniture(ctx: Ctx, state: WirewormState, sprites: Sprites): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, BOARD_Y, BOARD_W, BOARD_H);
  ctx.clip();
  ctx.globalAlpha = 0.3;
  const pulse = pairFrame(state.simTime, NODE_PULSE_FPS);
  const nodes: [number, number, number][] = [
    [4, 2, 0],
    [9, 4, 1],
    [30, 3, 2],
    [34, 6, 3],
    [6, 9, 1],
    [36, 12, 2],
  ];
  for (const [c, r, charge] of nodes) {
    drawNode(ctx, sprites, c, r, charge, pulse);
  }
  const rest = pairFrame(state.simTime, WORM_BODY_FPS);
  drawSprite(
    ctx,
    sprites.worm[WORM_PAIR.tail + rest],
    tileCX(30),
    tileCY(1),
    false,
  );
  drawSprite(
    ctx,
    sprites.worm[WORM_PAIR.body + rest],
    tileCX(31),
    tileCY(1),
    false,
  );
  drawSprite(
    ctx,
    sprites.worm[WORM_PAIR.head + pairFrame(state.simTime, WORM_HEAD_FPS)],
    tileCX(32),
    tileCY(1),
    false,
  );
  ctx.restore();
}

function drawTitle(ctx: Ctx, state: WirewormState): void {
  const cx = STAGE_W / 2;
  write(ctx, TITLE_TEXT, cx, 224, {
    size: 96,
    weight: 700,
    color: COLOR.text,
    align: "center",
    glow: COLOR.arcGlow,
  });
  write(ctx, TAGLINE_TEXT, cx, 274, {
    size: 24,
    weight: 400,
    color: COLOR.score,
    align: "center",
  });
  drawMenu(ctx, TITLE_ITEMS, state.menuIndex, cx, 396, 60, 30);
  write(ctx, TITLE_HINT, cx, STAGE_H - 46, {
    size: 16,
    weight: 400,
    color: COLOR.textFaint,
    align: "center",
  });
}

function drawHowTo(ctx: Ctx): void {
  const cx = STAGE_W / 2;
  write(ctx, HOWTO_TITLE, cx, 122, {
    size: 40,
    weight: 700,
    color: COLOR.text,
    align: "center",
  });
  // Left-aligned on a fixed margin: the rules read as prose rather than as a
  // ragged stack, and every line lands inside the board region.
  let y = 168;
  for (const line of HOWTO_LINES) {
    if (line.length > 0) {
      write(ctx, line, 300, y, {
        size: 18,
        weight: 400,
        color: COLOR.textDim,
        align: "left",
      });
    }
    y += 23;
  }
  write(ctx, HOWTO_HINT, cx, STAGE_H - 22, {
    size: 16,
    weight: 400,
    color: COLOR.textFaint,
    align: "center",
  });
}

function drawPause(ctx: Ctx, state: WirewormState): void {
  scrim(ctx);
  const cx = STAGE_W / 2;
  write(ctx, "PAUSED", cx, 250, {
    size: 56,
    weight: 700,
    color: COLOR.text,
    align: "center",
  });
  drawMenu(ctx, PAUSE_ITEMS, state.menuIndex, cx, 360, 58, 28);
}

function drawVictory(ctx: Ctx, state: WirewormState): void {
  scrim(ctx);
  const cx = STAGE_W / 2;
  write(ctx, "VICTORY", cx, 214, {
    size: 66,
    weight: 700,
    color: COLOR.score,
    align: "center",
  });
  write(ctx, `SCORE ${state.score}`, cx, 276, {
    size: 30,
    weight: 700,
    color: COLOR.text,
    align: "center",
  });
  write(ctx, `ALL ${TOTAL_LEVELS} LEVELS CLEARED`, cx, 318, {
    size: 22,
    weight: 400,
    color: COLOR.textDim,
    align: "center",
  });
  write(ctx, `LIVES REMAINING ${state.lives}`, cx, 352, {
    size: 22,
    weight: 400,
    color: COLOR.textDim,
    align: "center",
  });
  drawMenu(ctx, ENDING_ITEMS, state.menuIndex, cx, 440, 56, 28);
}

function drawGameOver(ctx: Ctx, state: WirewormState): void {
  scrim(ctx);
  const cx = STAGE_W / 2;
  write(ctx, "GAME OVER", cx, 224, {
    size: 62,
    weight: 700,
    color: COLOR.text,
    align: "center",
  });
  write(ctx, `SCORE ${state.score}`, cx, 288, {
    size: 30,
    weight: 700,
    color: COLOR.score,
    align: "center",
  });
  write(ctx, `REACHED ${HUD_LEVEL_LABEL} ${state.reachedLevel}`, cx, 330, {
    size: 22,
    weight: 400,
    color: COLOR.textDim,
    align: "center",
  });
  drawMenu(ctx, ENDING_ITEMS, state.menuIndex, cx, 424, 56, 28);
}

/** The level banner, over the board while the level opens. */
function drawBanner(ctx: Ctx, text: string): void {
  ctx.save();
  ctx.fillStyle = COLOR.scrim;
  ctx.fillRect(0, 300, STAGE_W, 120);
  write(ctx, text, STAGE_W / 2, 380, {
    size: 58,
    weight: 700,
    color: COLOR.banner,
    align: "center",
  });
  ctx.restore();
}

/**
 * A vertical menu.
 *
 * The highlighted item is drawn in the highlight color with a marker beside it,
 * and the marker is a draw of its own so that an item's own text is exactly the
 * word `specs/ui.md` fixes.
 */
function drawMenu(
  ctx: Ctx,
  items: readonly string[],
  selected: number,
  cx: number,
  top: number,
  spacing: number,
  size: number,
): void {
  items.forEach((item, at) => {
    const y = top + at * spacing;
    const on = at === selected;
    write(ctx, item, cx, y, {
      size,
      weight: on ? 700 : 400,
      color: on ? COLOR.highlight : COLOR.textDim,
      align: "center",
    });
    if (!on) return;
    const width = measure(ctx, item, size, 700);
    write(ctx, "▸", cx - width / 2 - 24, y, {
      size,
      weight: 700,
      color: COLOR.highlight,
      align: "center",
    });
  });
}

/** The dark plate a menu is laid over the board on. */
function scrim(ctx: Ctx): void {
  ctx.fillStyle = COLOR.scrim;
  ctx.fillRect(0, 0, STAGE_W, STAGE_H);
}

// ---- Type ----------------------------------------------------------------

interface TextStyle {
  size: number;
  weight: number;
  color: string;
  align: CanvasTextAlign;
  glow?: string;
}

function write(
  ctx: Ctx,
  text: string,
  x: number,
  y: number,
  style: TextStyle,
): void {
  ctx.save();
  ctx.font = `${style.weight} ${style.size}px ${MONO}`;
  ctx.textAlign = style.align;
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = style.color;
  if (style.glow !== undefined) {
    ctx.shadowColor = style.glow;
    ctx.shadowBlur = 24;
  }
  ctx.fillText(text, x, y);
  ctx.restore();
}

function label(
  ctx: Ctx,
  text: string,
  x: number,
  y: number,
  align: CanvasTextAlign,
): void {
  write(ctx, text, x, y, {
    size: HUD_LABEL_PX,
    weight: 400,
    color: COLOR.textFaint,
    align,
  });
}

function measure(ctx: Ctx, text: string, size: number, weight: number): number {
  ctx.save();
  ctx.font = `${weight} ${size}px ${MONO}`;
  const width = ctx.measureText(text).width;
  ctx.restore();
  return width;
}
