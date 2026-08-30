// Coil — every frame the game draws (specs/ui.md, specs/overview.md).
//
// The board, its ruling and wall border, the obstacle course, the pellet, the HUD,
// the menus and the panels are drawn in code in the palette `src/theme.ts` holds.
// The snake is drawn from the produced sprite set alone: the head sheet turned to
// the snake's facing and playing its bite, the straight sprite turned to a run, the
// corner sprite at every bend, and the tail sprite turned toward its one neighbor.
// Every sprite is sampled with smoothing off, so the pixel art stays sharp at every
// scale the stage is fitted to.
//
// Everything is laid out in logical units on the fixed `STAGE_W x STAGE_H` stage.
// The runtime is what maps that stage onto the device pixels of the canvas.

import type { Assets } from "./assets";
import {
  BEST_LABEL,
  CELL,
  CLEARED_TEXT,
  COMBO_MAX,
  GAMEOVER_TEXT,
  GRID_COLS,
  GRID_ROWS,
  INTERIOR_COL_MAX,
  INTERIOR_COL_MIN,
  INTERIOR_ROW_MAX,
  INTERIOR_ROW_MIN,
  SCORE_LABEL,
  STAGE_CX,
  STAGE_H,
  STAGE_W,
  TAGLINE_TEXT,
  TITLE_TEXT,
  cellX,
  cellY,
  type Cell,
  type Dir,
} from "./constants";
import { roundRect, text } from "./draw";
import type { Game } from "./game";
import { menuItems } from "./menus";
import { MODE_LABEL } from "./mode";
import type { Sim } from "./sim";
import { COLORS, FONT } from "./theme";

/** What the renderer needs beyond the game itself. */
export interface RenderView {
  /** Seconds since the build started, for the pellet's pulse. */
  time: number;
  /** The head sheet's current frame, 0 at rest. */
  biteFrame: number;
}

const ANGLE: Record<Dir, number> = {
  right: 0,
  down: Math.PI / 2,
  left: Math.PI,
  up: -Math.PI / 2,
};

const UNIT: Record<Dir, { x: number; y: number }> = {
  right: { x: 1, y: 0 },
  left: { x: -1, y: 0 },
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
};

const AXIS: Record<Dir, "horizontal" | "vertical"> = {
  up: "vertical",
  down: "vertical",
  left: "horizontal",
  right: "horizontal",
};

function directionBetween(from: Cell, to: Cell): Dir {
  if (to.col > from.col) return "right";
  if (to.col < from.col) return "left";
  if (to.row > from.row) return "down";
  return "up";
}

// ---- The board ---------------------------------------------------------------

function drawField(ctx: CanvasRenderingContext2D): void {
  // The wall ring, filled whole and then punched out to leave the interior.
  ctx.fillStyle = COLORS.wall;
  ctx.fillRect(cellX(0), cellY(0), CELL * GRID_COLS, CELL * GRID_ROWS);
  const x = cellX(INTERIOR_COL_MIN);
  const y = cellY(INTERIOR_ROW_MIN);
  const width = CELL * (INTERIOR_COL_MAX - INTERIOR_COL_MIN + 1);
  const height = CELL * (INTERIOR_ROW_MAX - INTERIOR_ROW_MIN + 1);
  ctx.fillStyle = COLORS.field;
  ctx.fillRect(x, y, width, height);

  // The faint per-cell ruling, so a player counts cells without it dominating.
  ctx.strokeStyle = COLORS.rule;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let col = INTERIOR_COL_MIN; col <= INTERIOR_COL_MAX + 1; col++) {
    ctx.moveTo(cellX(col) + 0.5, y);
    ctx.lineTo(cellX(col) + 0.5, y + height);
  }
  for (let row = INTERIOR_ROW_MIN; row <= INTERIOR_ROW_MAX + 1; row++) {
    ctx.moveTo(x, cellY(row) + 0.5);
    ctx.lineTo(x + width, cellY(row) + 0.5);
  }
  ctx.stroke();
}

function drawObstacles(
  ctx: CanvasRenderingContext2D,
  obstacles: readonly Cell[],
): void {
  if (obstacles.length === 0) return;
  ctx.save();
  ctx.shadowColor = COLORS.obstacle;
  ctx.shadowBlur = 10;
  ctx.fillStyle = COLORS.obstacle;
  for (const cell of obstacles) {
    roundRect(
      ctx,
      cellX(cell.col) + 2,
      cellY(cell.row) + 2,
      CELL - 4,
      CELL - 4,
      5,
    );
    ctx.fill();
  }
  ctx.restore();
}

function drawPellet(
  ctx: CanvasRenderingContext2D,
  pellet: Cell,
  time: number,
): void {
  const x = cellX(pellet.col) + CELL / 2;
  const y = cellY(pellet.row) + CELL / 2;
  const radius = 16 + (0.5 + 0.5 * Math.sin(time * 4)) * 4;
  const halo = ctx.createRadialGradient(x, y, 1, x, y, radius);
  halo.addColorStop(0, "rgba(255,92,138,0.55)");
  halo.addColorStop(1, "rgba(255,92,138,0)");
  ctx.fillStyle = halo;
  ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  ctx.fillStyle = COLORS.pellet;
  ctx.beginPath();
  ctx.arc(x, y, 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.5)";
  ctx.beginPath();
  ctx.arc(x - 2, y - 2, 2, 0, Math.PI * 2);
  ctx.fill();
}

// ---- The snake, drawn from the produced sprites -------------------------------

function drawSprite(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement | null,
  cell: Cell,
  angle: number,
): void {
  if (!image) return;
  ctx.save();
  ctx.translate(cellX(cell.col) + CELL / 2, cellY(cell.row) + CELL / 2);
  ctx.rotate(angle);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(image, -CELL / 2, -CELL / 2, CELL, CELL);
  ctx.restore();
}

/**
 * Draw the corner sprite on a bend.
 *
 * The sprite is authored with its two arms opening east and south. Mapping its east
 * axis onto the head-ward neighbour and its south axis onto the tail-ward one lands
 * both openings on the segments either side, so the coil runs continuously through
 * the bend whichever way it turns.
 */
function drawCorner(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement | null,
  cell: Cell,
  toHead: Dir,
  toTail: Dir,
): void {
  if (!image) return;
  const head = UNIT[toHead];
  const tail = UNIT[toTail];
  ctx.save();
  ctx.translate(cellX(cell.col) + CELL / 2, cellY(cell.row) + CELL / 2);
  ctx.transform(head.x, head.y, tail.x, tail.y, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(image, -CELL / 2, -CELL / 2, CELL, CELL);
  ctx.restore();
}

function drawSnake(
  ctx: CanvasRenderingContext2D,
  sim: Sim,
  assets: Assets,
  biteFrame: number,
): void {
  const chain = sim.snake;
  if (chain.length === 0) return;
  const sprites = assets.snake;

  // A soft halo under the coil, brighter under the head, so the snake separates
  // from the field before the sprites are read.
  ctx.save();
  ctx.shadowBlur = 12;
  ctx.shadowColor = COLORS.body;
  ctx.fillStyle = "rgba(47,208,122,0.30)";
  for (let i = 1; i < chain.length; i++) {
    const cell = chain[i]!;
    roundRect(
      ctx,
      cellX(cell.col) + 5,
      cellY(cell.row) + 5,
      CELL - 10,
      CELL - 10,
      6,
    );
    ctx.fill();
  }
  const head = chain[0]!;
  ctx.shadowColor = COLORS.head;
  ctx.fillStyle = "rgba(94,243,140,0.45)";
  roundRect(
    ctx,
    cellX(head.col) + 4,
    cellY(head.row) + 4,
    CELL - 8,
    CELL - 8,
    6,
  );
  ctx.fill();
  ctx.restore();

  for (let i = 1; i < chain.length; i++) {
    const cell = chain[i]!;
    if (i === chain.length - 1) {
      // The tail points away from the segment ahead of it.
      const outgoing = directionBetween(chain[i - 1]!, cell);
      drawSprite(ctx, sprites.tail, cell, ANGLE[outgoing]);
      continue;
    }
    const toHead = directionBetween(cell, chain[i - 1]!);
    const toTail = directionBetween(cell, chain[i + 1]!);
    if (AXIS[toHead] === AXIS[toTail]) {
      drawSprite(ctx, sprites.body, cell, ANGLE[toHead]);
    } else {
      drawCorner(ctx, sprites.corner, cell, toHead, toTail);
    }
  }

  const frame = Math.max(0, Math.min(sprites.head.length - 1, biteFrame));
  drawSprite(ctx, sprites.head[frame] ?? null, head, ANGLE[sim.dir]);
}

function drawBoard(
  ctx: CanvasRenderingContext2D,
  game: Game,
  assets: Assets,
  view: RenderView,
): void {
  drawField(ctx);
  drawObstacles(ctx, game.sim.obstacles);
  if (game.sim.pellet) drawPellet(ctx, game.sim.pellet, view.time);
  drawSnake(ctx, game.sim, assets, view.biteFrame);
}

// ---- The HUD ------------------------------------------------------------------

function drawHud(
  ctx: CanvasRenderingContext2D,
  game: Game,
  quiet: boolean,
): void {
  const alpha = quiet ? 0.5 : 1;
  const sim = game.sim;

  text(ctx, MODE_LABEL, 40, 66, {
    size: 18,
    color: COLORS.textFaint,
    spacing: 3,
    alpha,
  });

  text(ctx, SCORE_LABEL, 200, 44, {
    size: 18,
    color: COLORS.textDim,
    spacing: 4,
    alpha,
  });
  text(ctx, String(sim.score), 200, 90, {
    size: 44,
    color: COLORS.text,
    bold: true,
    spacing: 2,
    alpha,
  });

  text(ctx, BEST_LABEL, 1080, 44, {
    size: 18,
    color: COLORS.textDim,
    spacing: 4,
    align: "right",
    alpha,
  });
  text(ctx, String(game.best), 1080, 90, {
    size: 44,
    color: COLORS.text,
    bold: true,
    spacing: 2,
    align: "right",
    alpha,
  });

  // The multiplier and its draining bar, shown only from an M of 2 upward.
  if (sim.combo >= 2 && sim.combo <= COMBO_MAX) {
    text(ctx, `x${sim.combo}`, STAGE_CX, 70, {
      size: 34,
      color: COLORS.combo,
      bold: true,
      align: "center",
      glow: quiet ? 0 : 12,
      alpha,
    });
    const width = 150;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = "rgba(255,210,63,0.18)";
    ctx.fillRect(STAGE_CX - width / 2, 86, width, 4);
    ctx.fillStyle = COLORS.combo;
    ctx.fillRect(STAGE_CX - width / 2, 86, width * sim.comboFraction(), 4);
    ctx.restore();
  }

  text(ctx, game.muted ? "MUTED [M]" : "SOUND [M]", 1240, 106, {
    size: 15,
    color: game.muted ? COLORS.combo : COLORS.textFaint,
    spacing: 2,
    align: "right",
    alpha,
  });
}

// ---- Menus and panels ---------------------------------------------------------

function drawMenu(
  ctx: CanvasRenderingContext2D,
  items: readonly string[],
  selected: number,
  centerX: number,
  topY: number,
  gap: number,
  size: number,
): void {
  for (let i = 0; i < items.length; i++) {
    const label = items[i]!;
    const y = topY + i * gap;
    const on = i === selected;
    text(ctx, label, centerX, y, {
      size,
      color: on ? COLORS.text : COLORS.textDim,
      bold: on,
      align: "center",
      spacing: 4,
      glow: on ? 10 : 0,
      glowColor: COLORS.head,
    });
    if (!on) continue;
    const half = measureLabel(ctx, label, size) / 2;
    text(ctx, "▶", centerX - half - 30, y, {
      size: size - 8,
      color: COLORS.head,
      align: "center",
    });
    text(ctx, "◀", centerX + half + 30, y, {
      size: size - 8,
      color: COLORS.head,
      align: "center",
    });
  }
}

/**
 * The width of a menu label, measured in the font and letter spacing it is drawn
 * in, so the markers either side of the highlighted item clear the text.
 */
function measureLabel(
  ctx: CanvasRenderingContext2D,
  label: string,
  size: number,
): number {
  ctx.save();
  ctx.font = `bold ${size}px ${FONT}`;
  ctx.letterSpacing = "4px";
  const width = ctx.measureText(label).width;
  ctx.restore();
  return width;
}

function dim(ctx: CanvasRenderingContext2D, alpha: number): void {
  ctx.fillStyle = `rgba(11,14,20,${alpha})`;
  ctx.fillRect(0, 0, STAGE_W, STAGE_H);
}

function panel(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  ctx.fillStyle = COLORS.panel;
  roundRect(ctx, x, y, width, height, 16);
  ctx.fill();
  ctx.strokeStyle = COLORS.panelEdge;
  ctx.lineWidth = 1;
  roundRect(ctx, x, y, width, height, 16);
  ctx.stroke();
}

function drawTitle(
  ctx: CanvasRenderingContext2D,
  game: Game,
  assets: Assets,
): void {
  ctx.strokeStyle = "rgba(42,53,80,0.5)";
  ctx.lineWidth = 1;
  roundRect(ctx, 160, 118, 960, 580, 14);
  ctx.stroke();

  drawTitleCoil(ctx, assets);

  text(ctx, TITLE_TEXT, STAGE_CX, 262, {
    size: 150,
    color: COLORS.head,
    bold: true,
    align: "center",
    glow: 34,
    spacing: 6,
  });
  text(ctx, TAGLINE_TEXT, STAGE_CX, 358, {
    size: 30,
    color: COLORS.textDim,
    align: "center",
    spacing: 10,
  });
  text(ctx, BEST_LABEL, STAGE_CX, 402, {
    size: 18,
    color: COLORS.textFaint,
    align: "center",
    spacing: 5,
  });
  text(ctx, String(game.best), STAGE_CX, 434, {
    size: 26,
    color: COLORS.text,
    bold: true,
    align: "center",
    spacing: 2,
  });

  drawMenu(ctx, menuItems("title"), game.menuIndex, STAGE_CX, 516, 58, 30);
  text(ctx, "▲ ▼ MOVE     ENTER SELECT", STAGE_CX, 686, {
    size: 16,
    color: COLORS.textFaint,
    align: "center",
    spacing: 4,
  });
}

/** A dimmed hooked coil behind the title, so the board furniture is present. */
function drawTitleCoil(ctx: CanvasRenderingContext2D, assets: Assets): void {
  const sprites = assets.snake;
  ctx.save();
  ctx.globalAlpha = 0.18;
  const at = (
    image: HTMLImageElement | null,
    dx: number,
    dy: number,
    angle: number,
  ): void => {
    if (!image) return;
    ctx.save();
    ctx.translate(630 + dx + CELL / 2, 320 + dy + CELL / 2);
    ctx.rotate(angle);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(image, -CELL / 2, -CELL / 2, CELL, CELL);
    ctx.restore();
  };
  at(sprites.tail, 0, -32, -Math.PI / 2);
  at(sprites.body, 0, 0, Math.PI / 2);
  at(sprites.corner, 0, 32, Math.PI);
  at(sprites.head[0] ?? null, -32, 32, Math.PI);
  ctx.restore();
}

const HOWTO_LINES: readonly [string, string][] = [
  ["MOVE", "The snake never stops. Steering turns it on"],
  ["", "the next step, and it can only turn across"],
  ["", "its heading, so it never doubles back."],
  ["GROW", "Eat a pellet and the snake grows one cell."],
  ["", "The longer it is, the less room you have."],
  ["AVOID", "The wall border and your own body are fatal."],
  ["COMBO", "Eat pellets in quick succession to build the"],
  ["", "multiplier, up to x5. Dawdle and the window"],
  ["", "runs out and the multiplier falls back to 1."],
  ["KEYS", "ArrowUp / KeyW up, ArrowDown / KeyS down,"],
  ["", "ArrowLeft / KeyA left, ArrowRight / KeyD right."],
  ["", "Enter or Space selects. Escape or KeyP pauses."],
  ["", "KeyM toggles sound."],
];

function drawHowto(ctx: CanvasRenderingContext2D, game: Game): void {
  ctx.strokeStyle = "rgba(42,53,80,0.5)";
  ctx.lineWidth = 1;
  roundRect(ctx, 200, 96, 880, 600, 14);
  ctx.stroke();

  text(ctx, "HOW TO PLAY", STAGE_CX, 168, {
    size: 42,
    color: COLORS.head,
    bold: true,
    align: "center",
    glow: 18,
    spacing: 4,
  });

  let y = 234;
  for (const [tag, body] of HOWTO_LINES) {
    if (tag) {
      text(ctx, tag, 250, y, {
        size: 20,
        color: COLORS.combo,
        bold: true,
        spacing: 2,
      });
    }
    text(ctx, body, 360, y, { size: 20, color: COLORS.textDim, spacing: 1 });
    y += 32;
  }

  drawMenu(ctx, menuItems("howto"), game.menuIndex, STAGE_CX, 660, 40, 24);
}

function drawPausePanel(ctx: CanvasRenderingContext2D, game: Game): void {
  panel(ctx, 400, 190, 480, 340);
  text(ctx, "PAUSED", STAGE_CX, 280, {
    size: 46,
    color: COLORS.head,
    bold: true,
    align: "center",
    glow: 18,
    spacing: 4,
  });
  drawMenu(ctx, menuItems("paused"), game.menuIndex, STAGE_CX, 358, 50, 26);
}

function drawEndPanel(
  ctx: CanvasRenderingContext2D,
  game: Game,
  cleared: boolean,
): void {
  panel(ctx, 360, 148, 560, 420);
  const heading = cleared ? CLEARED_TEXT : GAMEOVER_TEXT;
  text(ctx, heading, STAGE_CX, 264, {
    size: cleared ? 48 : 56,
    color: COLORS.head,
    bold: true,
    align: "center",
    glow: 20,
    spacing: 2,
  });
  text(ctx, SCORE_LABEL, STAGE_CX, 314, {
    size: 20,
    color: COLORS.textDim,
    align: "center",
    spacing: 5,
  });
  text(ctx, String(game.sim.score), STAGE_CX, 356, {
    size: 38,
    color: COLORS.text,
    bold: true,
    align: "center",
    spacing: 2,
  });
  text(ctx, BEST_LABEL, STAGE_CX, 394, {
    size: 18,
    color: COLORS.textDim,
    align: "center",
    spacing: 5,
  });
  text(ctx, String(game.best), STAGE_CX, 424, {
    size: 24,
    color: COLORS.textDim,
    bold: true,
    align: "center",
    spacing: 2,
  });
  drawMenu(
    ctx,
    menuItems(cleared ? "cleared" : "gameover"),
    game.menuIndex,
    STAGE_CX,
    482,
    52,
    30,
  );
}

// ---- The frame ----------------------------------------------------------------

/** Draw one whole frame of the stage, in logical units. */
export function render(
  ctx: CanvasRenderingContext2D,
  game: Game,
  assets: Assets,
  view: RenderView,
): void {
  ctx.fillStyle = COLORS.stage;
  ctx.fillRect(0, 0, STAGE_W, STAGE_H);

  switch (game.screen) {
    case "title":
      drawTitle(ctx, game, assets);
      return;
    case "howto":
      drawHowto(ctx, game);
      return;
    case "playing":
      drawBoard(ctx, game, assets, view);
      drawHud(ctx, game, false);
      return;
    case "paused":
      drawBoard(ctx, game, assets, view);
      drawHud(ctx, game, true);
      dim(ctx, 0.55);
      drawPausePanel(ctx, game);
      return;
    case "gameover":
    case "cleared":
      drawBoard(ctx, game, assets, view);
      drawHud(ctx, game, true);
      dim(ctx, 0.55);
      drawEndPanel(ctx, game, game.screen === "cleared");
      return;
  }
}
