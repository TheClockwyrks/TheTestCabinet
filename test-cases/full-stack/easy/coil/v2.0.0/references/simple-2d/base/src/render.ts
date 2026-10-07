// Coil — every frame the game draws (specs/ui.md, specs/overview.md).
//
// `renderGame` is a pure read of the state it is handed: nothing here advances or
// stores anything, and the context arrives cleared to `BACKGROUND` and already
// carrying the logical transform, so no code below reads the canvas element's
// size and everything is laid out in logical units on the fixed stage.
//
// The board, its ruling and wall border, the obstacle course, the pellet, the HUD,
// the menus and the panels are drawn in code in the palette `src/theme.ts` holds.
// The snake is drawn from the produced sprite set alone: the head sheet turned to
// the snake's facing and playing its bite, the straight sprite turned to a run,
// the corner sprite at every bend, and the tail sprite turned toward its one
// neighbor. Every sprite is sampled with smoothing off, so the pixel art stays
// sharp at every scale the stage is fitted to.

import { cellX, cellY } from "./board";
import {
  BEST_LABEL,
  BINDINGS,
  CELL,
  CLEARED_TEXT,
  COMBO_MAX,
  GAMEOVER_TEXT,
  GRID_COLS,
  GRID_ROWS,
  INTERIOR_MAX_COL,
  INTERIOR_MAX_ROW,
  INTERIOR_MIN_COL,
  INTERIOR_MIN_ROW,
  MODE_LABEL,
  SCORE_LABEL,
  STAGE_CX,
  STAGE_H,
  STAGE_W,
  TAGLINE_TEXT,
  TITLE_TEXT,
  type Cell,
  type Direction,
  type Screen,
} from "./constants";
import { roundRect, text } from "./draw";
import { biteFrame, type CoilState } from "./game";
import { HAS_OBSTACLES } from "./mode";
import { menuItems, menuLayout } from "./menus";
import { axisOf, comboFraction } from "./sim";
import { COLORS, FONT } from "./theme";
import type { SnakeSprites } from "./assets";
import type { DeepReadonly } from "ts-essentials";

type Ctx = CanvasRenderingContext2D;
type View = DeepReadonly<CoilState>;

const ANGLE: Readonly<Record<Direction, number>> = {
  right: 0,
  down: Math.PI / 2,
  left: Math.PI,
  up: -Math.PI / 2,
};

const UNIT: Readonly<Record<Direction, { x: number; y: number }>> = {
  right: { x: 1, y: 0 },
  left: { x: -1, y: 0 },
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
};

function directionBetween(from: Cell, to: Cell): Direction {
  if (to.col > from.col) return "right";
  if (to.col < from.col) return "left";
  if (to.row > from.row) return "down";
  return "up";
}

// ---- The board -----------------------------------------------------------

function drawField(ctx: Ctx): void {
  // The wall ring, filled whole and then punched out to leave the interior.
  ctx.fillStyle = COLORS.wall;
  ctx.fillRect(cellX(0), cellY(0), CELL * GRID_COLS, CELL * GRID_ROWS);
  const x = cellX(INTERIOR_MIN_COL);
  const y = cellY(INTERIOR_MIN_ROW);
  const width = CELL * (INTERIOR_MAX_COL - INTERIOR_MIN_COL + 1);
  const height = CELL * (INTERIOR_MAX_ROW - INTERIOR_MIN_ROW + 1);
  ctx.fillStyle = COLORS.field;
  ctx.fillRect(x, y, width, height);

  // The faint per-cell ruling, so a player counts cells without it dominating.
  ctx.strokeStyle = COLORS.rule;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let col = INTERIOR_MIN_COL; col <= INTERIOR_MAX_COL + 1; col++) {
    ctx.moveTo(cellX(col) + 0.5, y);
    ctx.lineTo(cellX(col) + 0.5, y + height);
  }
  for (let row = INTERIOR_MIN_ROW; row <= INTERIOR_MAX_ROW + 1; row++) {
    ctx.moveTo(x, cellY(row) + 0.5);
    ctx.lineTo(x + width, cellY(row) + 0.5);
  }
  ctx.stroke();
}

function drawObstacles(ctx: Ctx, obstacles: readonly Cell[]): void {
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

function drawPellet(ctx: Ctx, pellet: Cell, time: number): void {
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

// ---- The snake, drawn from the produced sprites --------------------------

function drawSprite(
  ctx: Ctx,
  image: ImageBitmap | null,
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
 * The sprite is authored with its two arms opening east and south. Mapping its
 * east axis onto the head-ward neighbour and its south axis onto the tail-ward one
 * lands both openings on the segments either side, so the coil runs continuously
 * through the bend whichever way it turns.
 */
function drawCorner(
  ctx: Ctx,
  image: ImageBitmap | null,
  cell: Cell,
  toHead: Direction,
  toTail: Direction,
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
  ctx: Ctx,
  chain: readonly Cell[],
  dir: Direction,
  sprites: SnakeSprites,
  frame: number,
): void {
  if (chain.length === 0) return;

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
      // The tail JOINS the segment ahead of it. The sprite is authored joining
      // east (`scripts/gen-sprites.sh`), so the quarter turn that carries `right`
      // onto the direction from this cell to its one neighbour puts the join edge
      // against that neighbour and the taper on the free side.
      const toNeighbor = directionBetween(cell, chain[i - 1]!);
      drawSprite(ctx, sprites.tail, cell, ANGLE[toNeighbor]);
      continue;
    }
    const toHead = directionBetween(cell, chain[i - 1]!);
    const toTail = directionBetween(cell, chain[i + 1]!);
    if (axisOf(toHead) === axisOf(toTail)) {
      drawSprite(ctx, sprites.body, cell, ANGLE[toHead]);
    } else {
      drawCorner(ctx, sprites.corner, cell, toHead, toTail);
    }
  }

  const index = Math.max(0, Math.min(sprites.head.length - 1, frame));
  drawSprite(ctx, sprites.head[index] ?? null, head, ANGLE[dir]);
}

function drawBoard(state: View, ctx: Ctx): void {
  drawField(ctx);
  drawObstacles(ctx, state.obstacles);
  if (state.pellet) drawPellet(ctx, state.pellet, state.simTime);
  drawSnake(ctx, state.snake, state.dir, state.sprites, biteFrame(state));
}

// ---- The HUD -------------------------------------------------------------

function drawHud(state: View, ctx: Ctx, quiet: boolean): void {
  const alpha = quiet ? 0.5 : 1;

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
  text(ctx, String(state.score), 200, 90, {
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
  text(ctx, String(state.best), 1080, 90, {
    size: 44,
    color: COLORS.text,
    bold: true,
    spacing: 2,
    align: "right",
    alpha,
  });

  // The multiplier and its draining bar, shown only from an M of 2 upward.
  if (state.combo >= 2 && state.combo <= COMBO_MAX) {
    text(ctx, `x${state.combo}`, STAGE_CX, 70, {
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
    ctx.fillRect(STAGE_CX - width / 2, 86, width * comboFraction(state), 4);
    ctx.restore();
  }

  text(ctx, state.muted ? "MUTED [M]" : "SOUND [M]", 1240, 106, {
    size: 15,
    color: state.muted ? COLORS.combo : COLORS.textFaint,
    spacing: 2,
    align: "right",
    alpha,
  });
}

// ---- Menus and panels ----------------------------------------------------

function drawMenu(ctx: Ctx, screen: Screen, selected: number): void {
  const layout = menuLayout(screen);
  if (layout === null) return;
  const items = menuItems(screen);
  for (let i = 0; i < items.length; i++) {
    const label = items[i]!;
    const y = layout.topY + i * layout.gap;
    const on = i === selected;
    text(ctx, label, layout.centerX, y, {
      size: layout.size,
      color: on ? COLORS.text : COLORS.textDim,
      bold: on,
      align: "center",
      spacing: 4,
      glow: on ? 10 : 0,
      glowColor: COLORS.head,
    });
    if (!on) continue;
    const half = measureLabel(ctx, label, layout.size) / 2;
    text(ctx, "▶", layout.centerX - half - 30, y, {
      size: layout.size - 8,
      color: COLORS.head,
      align: "center",
    });
    text(ctx, "◀", layout.centerX + half + 30, y, {
      size: layout.size - 8,
      color: COLORS.head,
      align: "center",
    });
  }
}

/**
 * The width of a menu label, measured in the font and letter spacing it is drawn
 * in, so the markers either side of the highlighted item clear the text.
 */
function measureLabel(ctx: Ctx, label: string, size: number): number {
  ctx.save();
  ctx.font = `bold ${size}px ${FONT}`;
  ctx.letterSpacing = "4px";
  const width = ctx.measureText(label).width;
  ctx.restore();
  return width;
}

function dim(ctx: Ctx, alpha: number): void {
  ctx.fillStyle = `rgba(11,14,20,${alpha})`;
  ctx.fillRect(0, 0, STAGE_W, STAGE_H);
}

function panel(
  ctx: Ctx,
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

function drawTitle(state: View, ctx: Ctx): void {
  ctx.strokeStyle = "rgba(42,53,80,0.5)";
  ctx.lineWidth = 1;
  roundRect(ctx, 160, 118, 960, 580, 14);
  ctx.stroke();

  drawTitleCoil(ctx, state.sprites);

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
  text(ctx, String(state.best), STAGE_CX, 434, {
    size: 26,
    color: COLORS.text,
    bold: true,
    align: "center",
    spacing: 2,
  });

  drawMenu(ctx, "title", state.menuIndex);
  text(ctx, "▲ ▼ MOVE     ENTER SELECT", STAGE_CX, 686, {
    size: 16,
    color: COLORS.textFaint,
    align: "center",
    spacing: 4,
  });
}

/** A dimmed hooked coil beside the title menu, so board furniture is present. */
function drawTitleCoil(ctx: Ctx, sprites: SnakeSprites): void {
  ctx.save();
  ctx.globalAlpha = 0.18;
  const at = (
    image: ImageBitmap | null,
    dx: number,
    dy: number,
    angle: number,
  ): void => {
    if (!image) return;
    ctx.save();
    ctx.translate(268 + dx + CELL / 2, 486 + dy + CELL / 2);
    ctx.rotate(angle);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(image, -CELL / 2, -CELL / 2, CELL, CELL);
    ctx.restore();
  };
  // Its one neighbour, the body cell, lies below it, so the join edge turns down.
  at(sprites.tail, 0, -32, Math.PI / 2);
  at(sprites.body, 0, 0, Math.PI / 2);
  at(sprites.corner, 0, 32, Math.PI);
  at(sprites.head[0] ?? null, -32, 32, Math.PI);
  ctx.restore();
}

/** What the fatal cells are depends on whether the mode lays a course of them. */
const FATAL_LINES: readonly (readonly [string, string])[] = HAS_OBSTACLES
  ? [
      ["AVOID", "The wall border, the bars across the board,"],
      ["", "and your own body are all fatal to the head."],
    ]
  : [["AVOID", "The wall border and your own body are fatal."]];

const HOWTO_LINES: readonly (readonly [string, string])[] = [
  ["MOVE", "The snake never stops. Steering turns it on"],
  ["", "the next step, and it can only turn across"],
  ["", "its heading, so it never doubles back."],
  ["GROW", "Eat a pellet and the snake grows one cell."],
  ["", "The longer it is, the less room you have."],
  ...FATAL_LINES,
  ["COMBO", "Eat pellets in quick succession to build the"],
  ["", `multiplier, up to x${COMBO_MAX}. Dawdle and the window`],
  ["", "runs out and the multiplier falls back to 1."],
  ["KEYS", `${BINDINGS.up.join(" / ")} up, ${BINDINGS.down.join(" / ")} down,`],
  [
    "",
    `${BINDINGS.left.join(" / ")} left, ${BINDINGS.right.join(" / ")} right.`,
  ],
  [
    "",
    `${BINDINGS.confirm.join(" or ")} selects. ${BINDINGS.back[0]} or ${BINDINGS.pause[0]} pauses.`,
  ],
  ["", `${BINDINGS.mute[0]} toggles sound.`],
];

function drawHowto(state: View, ctx: Ctx): void {
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

  let y = 226;
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
    y += 30;
  }

  drawMenu(ctx, "howto", state.menuIndex);
}

function drawPausePanel(state: View, ctx: Ctx): void {
  panel(ctx, 400, 190, 480, 340);
  text(ctx, "PAUSED", STAGE_CX, 280, {
    size: 46,
    color: COLORS.head,
    bold: true,
    align: "center",
    glow: 18,
    spacing: 4,
  });
  drawMenu(ctx, "paused", state.menuIndex);
}

function drawEndPanel(state: View, ctx: Ctx, cleared: boolean): void {
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
  text(ctx, String(state.score), STAGE_CX, 356, {
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
  text(ctx, String(state.best), STAGE_CX, 424, {
    size: 24,
    color: COLORS.textDim,
    bold: true,
    align: "center",
    spacing: 2,
  });
  drawMenu(ctx, cleared ? "cleared" : "gameover", state.menuIndex);
}

// ---- The frame -----------------------------------------------------------

/** Draw one whole frame of the stage, in logical units. */
export function renderGame(state: View, ctx: Ctx): void {
  // The engine clears the canvas to BACKGROUND before the frame, so the stage
  // needs no ground of its own and the letterbox bars already match it.
  switch (state.screen) {
    case "title":
      drawTitle(state, ctx);
      return;
    case "howto":
      drawHowto(state, ctx);
      return;
    case "playing":
      drawBoard(state, ctx);
      drawHud(state, ctx, false);
      return;
    case "paused":
      drawBoard(state, ctx);
      drawHud(state, ctx, true);
      dim(ctx, 0.55);
      drawPausePanel(state, ctx);
      return;
    case "gameover":
    case "cleared":
      drawBoard(state, ctx);
      drawHud(state, ctx, true);
      dim(ctx, 0.55);
      drawEndPanel(state, ctx, state.screen === "cleared");
      return;
  }
}
