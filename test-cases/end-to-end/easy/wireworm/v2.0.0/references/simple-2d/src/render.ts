// Wireworm — every pixel the game draws, in logical stage units.
//
// `api.ctx` arrives cleared to `BACKGROUND` and already carrying the logical
// transform, so everything here is written in the fixed 1280x720 space and
// nothing reads the canvas element's size. The state arrives read-only, so the
// type is what guarantees that drawing changes nothing.
//
// The board is drawn from the seeded art wherever the art is there: a node, a
// worm segment, the cursor and the three foes each come from their folder under
// `assets/`, at the frame `specs/assets.md` names for their state, mirrored
// horizontally where they face left. Everything else is drawn in code — the
// substrate and its trace grid, the band, a bolt, a discharge arc, the HUD, and
// every screen — and a frame that could not be loaded falls back to a shape
// drawn here, so the game still reads in a host that cannot decode an image.

import {
  BAND_TOP_Y,
  BOARD_H,
  BOARD_Y,
  CHARGE_MAX,
  CORRUPTOR_FPS,
  CURSOR_HALF,
  GLITCH_FPS,
  HUD_H,
  HUD_LEVEL_LABEL,
  NODE_PULSE_FPS,
  SPRITE_SIZE,
  TAGLINE_TEXT,
  TILE,
  TITLE_TEXT,
  TOTAL_LEVELS,
  WORM_BODY_FPS,
  WORM_HEAD_FPS,
  tileCX,
  tileCY,
  tileLeft,
  tileTop,
} from "./constants";
import {
  NODE_CRITICAL_ALT,
  WORM_BODY_FRAME,
  WORM_HEAD_FRAME,
  WORM_TAIL_FRAME,
  type Frames,
} from "./assets";
import {
  ENDING_MENU,
  PAUSE_MENU,
  TITLE_MENU,
  itemBaseline,
  type MenuLayout,
} from "./menus";
import { COLOR, font } from "./theme";
import type { WirewormState } from "./game";
import type { DeepReadonly } from "ts-essentials";

/** Which frame of a two-frame pair is showing, at `fps`, at this moment. */
function alternate(simTime: number, fps: number): number {
  return Math.floor(simTime * fps) % 2;
}

/** Which frame of a `count`-frame loop is showing, at `fps`, at this moment. */
function loopFrame(simTime: number, fps: number, count: number): number {
  return Math.floor(simTime * fps) % count;
}

/** Draw one sprite frame centered on `(cx, cy)`. Reports whether it drew. */
function drawSprite(
  ctx: CanvasRenderingContext2D,
  frames: Frames,
  index: number,
  cx: number,
  cy: number,
  mirrored = false,
): boolean {
  const frame = frames[index];
  if (frame === undefined || frame === null) return false;
  const half = SPRITE_SIZE / 2;
  ctx.save();
  ctx.translate(cx, cy);
  if (mirrored) ctx.scale(-1, 1);
  ctx.drawImage(frame, -half, -half, SPRITE_SIZE, SPRITE_SIZE);
  ctx.restore();
  return true;
}

/** Text drawn at a point, with the alignment given. */
function label(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  size: number,
  color: string,
  align: CanvasTextAlign = "left",
): void {
  ctx.font = font(size);
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = "alphabetic";
  ctx.fillText(text, x, y);
}

// ---- The board -----------------------------------------------------------

function drawBoard(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = COLOR.board;
  ctx.fillRect(0, BOARD_Y, tileLeft(40), BOARD_H);

  // The trace grid: a faint rule on every tile, a heavier one every eight, so
  // the board reads as a circuit substrate and a tile is countable by eye.
  for (let c = 0; c <= 40; c++) {
    ctx.fillStyle = c % 8 === 0 ? COLOR.gridMajor : COLOR.grid;
    ctx.fillRect(tileLeft(c) - 0.5, BOARD_Y, 1, BOARD_H);
  }
  for (let r = 0; r <= 20; r++) {
    ctx.fillStyle = r % 8 === 0 ? COLOR.gridMajor : COLOR.grid;
    ctx.fillRect(0, tileTop(r) - 0.5, tileLeft(40), 1);
  }

  // The player band, across the full width, with a lit rail along its top edge.
  ctx.fillStyle = COLOR.band;
  ctx.fillRect(0, BAND_TOP_Y, tileLeft(40), BOARD_Y + BOARD_H - BAND_TOP_Y);
  ctx.fillStyle = COLOR.bandEdge;
  ctx.fillRect(0, BAND_TOP_Y - 1, tileLeft(40), 2);
}

function drawNodes(
  ctx: CanvasRenderingContext2D,
  state: DeepReadonly<WirewormState>,
): void {
  const pulse = alternate(state.simTime, NODE_PULSE_FPS);
  for (const node of state.nodes) {
    const index =
      node.charge >= CHARGE_MAX && pulse === 1
        ? NODE_CRITICAL_ALT
        : node.charge;
    if (
      drawSprite(ctx, state.sprites.node, index, tileCX(node.c), tileCY(node.r))
    ) {
      continue;
    }
    // The fallback ramp: darkest inert, brightest critical, so the four states
    // still read as a ramp where the art did not arrive.
    const shade =
      ["#3b4a58", "#2f9e86", "#54e6bd", "#e6fff7"][node.charge] ?? "#3b4a58";
    ctx.fillStyle = shade;
    ctx.fillRect(
      tileLeft(node.c) + 5,
      tileTop(node.r) + 5,
      TILE - 10,
      TILE - 10,
    );
  }
}

function drawWorms(
  ctx: CanvasRenderingContext2D,
  state: DeepReadonly<WirewormState>,
): void {
  const headPhase = alternate(state.simTime, WORM_HEAD_FPS);
  const bodyPhase = alternate(state.simTime, WORM_BODY_FPS);

  for (const worm of state.worms) {
    const last = worm.segments.length - 1;
    worm.segments.forEach((tile, index) => {
      const base =
        index === 0
          ? WORM_HEAD_FRAME
          : index === last
            ? WORM_TAIL_FRAME
            : WORM_BODY_FRAME;
      const phase = index === 0 ? headPhase : bodyPhase;
      const drew = drawSprite(
        ctx,
        state.sprites.worm,
        base + phase,
        tileCX(tile.c),
        tileCY(tile.r),
        worm.dh < 0,
      );
      if (drew) return;
      ctx.fillStyle =
        index === 0 ? "#ff3fa4" : index === last ? "#7a2fae" : "#c06bff";
      ctx.fillRect(
        tileLeft(tile.c) + 2,
        tileTop(tile.r) + 2,
        TILE - 4,
        TILE - 4,
      );
    });
  }
}

function drawFoes(
  ctx: CanvasRenderingContext2D,
  state: DeepReadonly<WirewormState>,
): void {
  for (const foe of state.foes) {
    if (foe.kind === "glitch") {
      const frames = state.sprites.glitch;
      const index = loopFrame(state.simTime, GLITCH_FPS, frames.length || 1);
      if (drawSprite(ctx, frames, index, foe.x, foe.y)) continue;
      ctx.fillStyle = "#d92b4a";
    } else if (foe.kind === "dropper") {
      if (drawSprite(ctx, state.sprites.dropper, 0, foe.x, foe.y)) continue;
      ctx.fillStyle = "#e8a83a";
    } else {
      const frames = state.sprites.corruptor;
      const index = loopFrame(state.simTime, CORRUPTOR_FPS, frames.length || 1);
      if (drawSprite(ctx, frames, index, foe.x, foe.y, foe.vx < 0)) continue;
      ctx.fillStyle = "#8fd63a";
    }
    ctx.fillRect(foe.x - 12, foe.y - 12, 24, 24);
  }
}

function drawBolts(
  ctx: CanvasRenderingContext2D,
  state: DeepReadonly<WirewormState>,
): void {
  for (const bolt of state.bolts) {
    ctx.fillStyle = COLOR.boltGlow;
    ctx.fillRect(bolt.x - 3, bolt.y - 12, 6, 24);
    ctx.fillStyle = COLOR.bolt;
    ctx.fillRect(bolt.x - 1.5, bolt.y - 10, 3, 20);
  }
}

/**
 * A discharge arc: bright lightning joining the centers of the two tiles it
 * links.
 *
 * Its shape is fixed when the arc is created and holds for the arc's life,
 * which is what makes a discharge read as one bolt fading rather than as
 * static. The jitter that shapes it is drawn from the game's own generator,
 * seeded from the pair of tiles the link joins, so the shape is a pure function
 * of the arc and is the same on every frame the arc is drawn on.
 */
function drawArcs(
  ctx: CanvasRenderingContext2D,
  state: DeepReadonly<WirewormState>,
): void {
  const steps = 6;
  for (const arc of state.arcs) {
    const x0 = tileCX(arc.from.c);
    const y0 = tileCY(arc.from.r);
    const x1 = tileCX(arc.to.c);
    const y1 = tileCY(arc.to.r);
    const dx = x1 - x0;
    const dy = y1 - y0;
    const length = Math.hypot(dx, dy) || 1;
    const nx = -dy / length;
    const ny = dx / length;

    let seed =
      (arc.from.r * 40 + arc.from.c) * 1601 + (arc.to.r * 40 + arc.to.c) * 8017;
    const points: [number, number][] = [[x0, y0]];
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const [draw, next] = hashStep(seed);
      seed = next;
      const offset = (draw - 0.5) * 12;
      points.push([x0 + dx * t + nx * offset, y0 + dy * t + ny * offset]);
    }
    points.push([x1, y1]);

    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const [width, color] of [
      [6, COLOR.arcGlow],
      [2, COLOR.arcCore],
    ] as const) {
      ctx.lineWidth = width;
      ctx.strokeStyle = color;
      ctx.beginPath();
      points.forEach(([px, py], index) => {
        if (index === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.stroke();
    }
  }
}

function drawCursor(
  ctx: CanvasRenderingContext2D,
  state: DeepReadonly<WirewormState>,
): void {
  const { x, y, invulnerable } = state.cursor;

  if (invulnerable > 0 && alternate(state.simTime, 8) === 0) {
    ctx.strokeStyle = COLOR.invulnerable;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, CURSOR_HALF + 6, 0, Math.PI * 2);
    ctx.stroke();
  }

  if (drawSprite(ctx, state.sprites.cursor, 0, x, y)) return;
  ctx.fillStyle = "#9ff0ff";
  ctx.beginPath();
  ctx.moveTo(x, y - CURSOR_HALF);
  ctx.lineTo(x + CURSOR_HALF, y + CURSOR_HALF);
  ctx.lineTo(x - CURSOR_HALF, y + CURSOR_HALF);
  ctx.closePath();
  ctx.fill();
}

// ---- The HUD -------------------------------------------------------------

function drawHud(
  ctx: CanvasRenderingContext2D,
  state: DeepReadonly<WirewormState>,
  width: number,
): void {
  ctx.fillStyle = COLOR.hud;
  ctx.fillRect(0, 0, width, HUD_H);
  ctx.fillStyle = COLOR.hudEdge;
  ctx.fillRect(0, HUD_H - 2, width, 2);

  label(
    ctx,
    String(state.score).padStart(6, "0"),
    28,
    54,
    40,
    COLOR.textBright,
  );

  // Lives: one chevron each, with the count beside them so a long run stays
  // readable when the row would otherwise run on.
  const shown = Math.min(state.lives, 5);
  for (let i = 0; i < shown; i++) {
    const cx = 560 + i * 26;
    ctx.fillStyle = COLOR.accent;
    ctx.beginPath();
    ctx.moveTo(cx, 26);
    ctx.lineTo(cx + 9, 48);
    ctx.lineTo(cx - 9, 48);
    ctx.closePath();
    ctx.fill();
  }
  label(ctx, `x${state.lives}`, 560 + shown * 26 + 6, 47, 20, COLOR.text);

  label(
    ctx,
    `${HUD_LEVEL_LABEL} ${state.level} / ${TOTAL_LEVELS}`,
    width - 28,
    47,
    26,
    COLOR.text,
    "right",
  );
}

// ---- The screens ---------------------------------------------------------

function scrim(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  color: string,
): void {
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, width, height);
}

/**
 * A vertical menu, laid out where `src/menus.ts` says it is.
 *
 * The layout is read rather than restated, so the words a player sees stand
 * exactly over the hit regions `menuItemRect` reports (specs/ui.md).
 */
function drawMenu(
  ctx: CanvasRenderingContext2D,
  menu: MenuLayout,
  selected: number,
): void {
  menu.items.forEach((item, index) => {
    const chosen = index === selected;
    label(
      ctx,
      chosen ? `> ${item} <` : item,
      menu.centerX,
      itemBaseline(menu, index),
      chosen ? 30 : 26,
      chosen ? COLOR.accent : COLOR.textDim,
      "center",
    );
  });
}

const HOWTO_LINES: readonly string[] = [
  "Cut every segment of the data-worm before one reaches your band.",
  "",
  "A node the worm is turned by takes on charge. Shoot a fully charged",
  "node and it detonates, arcing through the charged cluster around it,",
  "clearing those nodes and frying every segment caught in the arc.",
  "",
  "A critical node the worm reaches sends it diving straight down.",
  "Every segment you cut leaves a node behind, so the field thickens",
  "as the fight goes on.",
  "",
  "GLITCH   skitters across the board and eats the nodes it crosses.",
  "DROPPER  falls down a column and seeds fresh nodes beneath it.",
  "CORRUPTOR  crawls the upper board and slams nodes to critical.",
  "",
  "Move with ARROWS or WASD.  Fire with SPACE.",
  "P pauses, M mutes, ESC goes back.",
];

function drawTitle(
  ctx: CanvasRenderingContext2D,
  state: DeepReadonly<WirewormState>,
  width: number,
  height: number,
): void {
  scrim(ctx, width, height, COLOR.scrim);
  label(ctx, TITLE_TEXT, width / 2, 240, 88, COLOR.accent, "center");
  label(ctx, TAGLINE_TEXT, width / 2, 292, 28, COLOR.text, "center");
  drawMenu(ctx, TITLE_MENU, state.menuIndex);
}

function drawHowto(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
): void {
  scrim(ctx, width, height, COLOR.scrim);
  label(ctx, "HOW TO PLAY", width / 2, 96, 44, COLOR.accent, "center");
  HOWTO_LINES.forEach((line, index) => {
    label(ctx, line, width / 2, 158 + index * 28, 19, COLOR.text, "center");
  });
  label(ctx, "ESC  BACK", width / 2, height - 40, 20, COLOR.textDim, "center");
}

function drawPaused(
  ctx: CanvasRenderingContext2D,
  state: DeepReadonly<WirewormState>,
  width: number,
  height: number,
): void {
  scrim(ctx, width, height, COLOR.scrim);
  label(ctx, "PAUSED", width / 2, 230, 62, COLOR.accent, "center");
  drawMenu(ctx, PAUSE_MENU, state.menuIndex);
}

function drawEnding(
  ctx: CanvasRenderingContext2D,
  state: DeepReadonly<WirewormState>,
  width: number,
  height: number,
): void {
  scrim(ctx, width, height, COLOR.scrim);
  const won = state.screen === "victory";
  label(
    ctx,
    won ? "CURRENT CUT" : "GAME OVER",
    width / 2,
    210,
    62,
    won ? COLOR.accent : COLOR.textBright,
    "center",
  );
  label(ctx, `SCORE ${state.score}`, width / 2, 276, 32, COLOR.text, "center");
  label(
    ctx,
    won
      ? `ALL ${TOTAL_LEVELS} LEVELS CLEARED   LIVES ${state.lives}`
      : `${HUD_LEVEL_LABEL} REACHED ${state.reachedLevel}`,
    width / 2,
    320,
    24,
    COLOR.textDim,
    "center",
  );
  drawMenu(ctx, ENDING_MENU, state.menuIndex);
}

function drawBanner(
  ctx: CanvasRenderingContext2D,
  state: DeepReadonly<WirewormState>,
  width: number,
  height: number,
): void {
  scrim(ctx, width, height, COLOR.scrimLight);
  label(
    ctx,
    `${HUD_LEVEL_LABEL} ${state.level}`,
    width / 2,
    height / 2,
    76,
    COLOR.accent,
    "center",
  );
}

// ---- The frame -----------------------------------------------------------

/** Draw the whole game, in logical stage units. */
export function renderGame(
  state: DeepReadonly<WirewormState>,
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
): void {
  drawBoard(ctx);
  drawNodes(ctx, state);
  drawWorms(ctx, state);
  drawFoes(ctx, state);
  drawArcs(ctx, state);
  drawBolts(ctx, state);
  // The cursor and the HUD belong to a run, so the two screens a run has not
  // opened from show the board alone behind their copy.
  const inRun = state.screen !== "title" && state.screen !== "howto";
  if (inRun) {
    drawCursor(ctx, state);
    drawHud(ctx, state, width);
  }

  switch (state.screen) {
    case "title":
      drawTitle(ctx, state, width, height);
      return;
    case "howto":
      drawHowto(ctx, width, height);
      return;
    case "paused":
      drawPaused(ctx, state, width, height);
      return;
    case "victory":
    case "gameover":
      drawEnding(ctx, state, width, height);
      return;
    case "playing":
      if (state.phase === "banner") drawBanner(ctx, state, width, height);
      return;
  }
}

/**
 * One step of a small integer mixer, used for the arc's jitter alone: the
 * draw in `[0, 1)` for `seed`, and the seed the next step takes. An arc's shape
 * is a function of the two tiles it joins, so it holds for the arc's whole life
 * without being stored (`specs/discharge.md`).
 */
function hashStep(seed: number): readonly [number, number] {
  const next = (seed + 0x6d2b79f5) | 0;
  let t = next;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return [((t ^ (t >>> 14)) >>> 0) / 4294967296, next];
}
