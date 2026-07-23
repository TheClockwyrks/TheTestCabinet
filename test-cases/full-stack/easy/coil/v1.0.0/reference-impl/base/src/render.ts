// Coil — all drawing (specs/overview.md palette, specs/ui.md HUD & screens).
//
// The board, walls, grid, pellet, obstacles, HUD, menus, and overlays are drawn in code in
// the Coil palette; the SNAKE is drawn entirely from the produced sprite set — the head
// sheet (rotated to facing, its bite frame played on eat), the straight body (rotated to its
// run axis), the corner sprite at every bend (rotated to the bend), and the tapering tail
// (rotated to its outgoing direction) — sampled nearest-neighbour so the pixel art stays
// crisp. Everything is laid out on the fixed 1280×720 logical stage; main.ts maps that stage
// to the device pixels.

import {
  C,
  CELL,
  FONT,
  IN_COL0,
  IN_COL1,
  IN_ROW0,
  IN_ROW1,
  STAGE_H,
  STAGE_W,
  cellX,
  cellY,
} from "./constants";
import type { Assets } from "./assets";
import type { Game } from "./game";
import { menuItems } from "./menus";
import type { Cell, Dir, Sim } from "./sim";

const AXIS: Record<Dir, "h" | "v"> = { up: "v", down: "v", left: "h", right: "h" };

export interface RenderView {
  time: number; // seconds since start (for glow pulse)
  biteFrame: number; // head frame index 0..3 (0 = resting)
  muted: boolean;
}

// ---- small text/shape helpers -------------------------------------------------

interface TextOpts {
  size: number;
  color: string;
  align?: CanvasTextAlign;
  bold?: boolean;
  glow?: number;
  glowColor?: string;
  spacing?: number;
  alpha?: number;
}

function text(ctx: CanvasRenderingContext2D, str: string, x: number, y: number, o: TextOpts): void {
  ctx.save();
  ctx.globalAlpha = o.alpha ?? 1;
  ctx.font = `${o.bold ? "bold " : ""}${o.size}px ${FONT}`;
  ctx.textAlign = o.align ?? "left";
  ctx.textBaseline = "alphabetic";
  ctx.letterSpacing = `${o.spacing ?? 0}px`;
  if (o.glow && o.glow > 0) {
    ctx.shadowColor = o.glowColor ?? o.color;
    ctx.shadowBlur = o.glow;
  }
  ctx.fillStyle = o.color;
  ctx.fillText(str, x, y);
  ctx.restore();
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function pad(n: number): string {
  return String(Math.max(0, Math.floor(n))).padStart(4, "0");
}

// ---- board furniture ----------------------------------------------------------

function drawBoard(ctx: CanvasRenderingContext2D, sim: Sim, view: RenderView): void {
  const bx = cellX(0);
  const by = cellY(0);
  // Wall ring: fill the whole board in the wall colour, then punch out the interior.
  ctx.fillStyle = C.wall;
  ctx.fillRect(bx, by, CELL * (IN_COL1 - IN_COL0 + 3), CELL * (IN_ROW1 - IN_ROW0 + 3));
  const ix = cellX(IN_COL0);
  const iy = cellY(IN_ROW0);
  const iw = CELL * (IN_COL1 - IN_COL0 + 1);
  const ih = CELL * (IN_ROW1 - IN_ROW0 + 1);
  ctx.fillStyle = C.boardBg;
  ctx.fillRect(ix, iy, iw, ih);

  // Faint per-cell grid inside the interior.
  ctx.strokeStyle = C.gridLine;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let col = IN_COL0; col <= IN_COL1 + 1; col++) {
    const x = cellX(col) + 0.5;
    ctx.moveTo(x, iy);
    ctx.lineTo(x, iy + ih);
  }
  for (let row = IN_ROW0; row <= IN_ROW1 + 1; row++) {
    const y = cellY(row) + 0.5;
    ctx.moveTo(ix, y);
    ctx.lineTo(ix + iw, y);
  }
  ctx.stroke();

  // Maze obstacles: fatal interior bars in the obstacle colour with a soft glow.
  if (sim.obstacles.length > 0) {
    ctx.save();
    ctx.shadowColor = C.obstacle;
    ctx.shadowBlur = 10;
    ctx.fillStyle = C.obstacle;
    for (const o of sim.obstacles) {
      roundRect(ctx, cellX(o.col) + 2, cellY(o.row) + 2, CELL - 4, CELL - 4, 5);
      ctx.fill();
    }
    ctx.restore();
  }

  if (sim.pellet) drawPellet(ctx, sim.pellet, view.time);
  drawSnake(ctx, sim, view.biteFrame);
}

function drawPellet(ctx: CanvasRenderingContext2D, pellet: Cell, time: number): void {
  const cx = cellX(pellet.col) + CELL / 2;
  const cy = cellY(pellet.row) + CELL / 2;
  const pulse = 0.5 + 0.5 * Math.sin(time * 4);
  const glowR = 16 + pulse * 4;
  const g = ctx.createRadialGradient(cx, cy, 1, cx, cy, glowR);
  g.addColorStop(0, "rgba(255,92,138,0.55)");
  g.addColorStop(1, "rgba(255,92,138,0)");
  ctx.fillStyle = g;
  ctx.fillRect(cx - glowR, cy - glowR, glowR * 2, glowR * 2);
  ctx.fillStyle = C.pellet;
  ctx.beginPath();
  ctx.arc(cx, cy, 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.5)";
  ctx.beginPath();
  ctx.arc(cx - 2, cy - 2, 2, 0, Math.PI * 2);
  ctx.fill();
}

// ---- the snake, drawn from the produced sprites -------------------------------

const ANGLE: Record<Dir, number> = {
  right: 0,
  down: Math.PI / 2,
  left: Math.PI,
  up: -Math.PI / 2,
};

// Unit screen-space vector per direction (y points down), used to orient the corner.
const VEC: Record<Dir, { x: number; y: number }> = {
  right: { x: 1, y: 0 },
  left: { x: -1, y: 0 },
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
};

function dirBetween(from: Cell, to: Cell): Dir {
  const dc = to.col - from.col;
  const dr = to.row - from.row;
  if (dc > 0) return "right";
  if (dc < 0) return "left";
  if (dr > 0) return "down";
  return "up";
}

function drawSprite(ctx: CanvasRenderingContext2D, img: HTMLImageElement, col: number, row: number, angle: number): void {
  const cx = cellX(col) + CELL / 2;
  const cy = cellY(row) + CELL / 2;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(angle);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, -CELL / 2, -CELL / 2, CELL, CELL);
  ctx.restore();
}

// The canonical corner sprite opens EAST (its head-ward arm) and SOUTH (its tail-ward
// arm), with its scale chevrons flowing tail-ward around the curve. Draw it with a linear
// map that sends the sprite's +x (east) axis onto the head neighbour's direction and its
// +y (south) axis onto the tail neighbour's — a rotation, or a rotation+reflection when the
// bend turns the other way. That keeps both the tube openings AND the chevrons aligned with
// the straight segments on either side, so the scales flow tail-ward straight through the bend.
function drawCorner(ctx: CanvasRenderingContext2D, img: HTMLImageElement, col: number, row: number, toHead: Dir, toTail: Dir): void {
  const cx = cellX(col) + CELL / 2;
  const cy = cellY(row) + CELL / 2;
  const h = VEC[toHead];
  const t = VEC[toTail];
  ctx.save();
  ctx.translate(cx, cy);
  ctx.transform(h.x, h.y, t.x, t.y, 0, 0); // east -> toHead, south -> toTail
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, -CELL / 2, -CELL / 2, CELL, CELL);
  ctx.restore();
}

// `assets` may be undefined only on the very first frames before load resolves; callers
// pass it once loaded. It is threaded through a module global so drawBoard needn't carry it.
let ASSETS: Assets | null = null;
export function setAssets(a: Assets): void {
  ASSETS = a;
}

function drawSnake(ctx: CanvasRenderingContext2D, sim: Sim, biteFrame: number): void {
  if (!ASSETS) return;
  const snake = sim.snake;
  const n = snake.length;
  const S = ASSETS.snake;

  // Soft neon glow underlay: a blurred halo behind the body, brighter behind the head.
  ctx.save();
  ctx.shadowBlur = 12;
  ctx.shadowColor = C.body;
  ctx.fillStyle = "rgba(47,208,122,0.30)";
  for (let i = 1; i < n; i++) {
    const c = snake[i]!;
    roundRect(ctx, cellX(c.col) + 5, cellY(c.row) + 5, CELL - 10, CELL - 10, 6);
    ctx.fill();
  }
  const head = snake[0]!;
  ctx.shadowColor = C.head;
  ctx.fillStyle = "rgba(94,243,140,0.45)";
  roundRect(ctx, cellX(head.col) + 4, cellY(head.row) + 4, CELL - 8, CELL - 8, 6);
  ctx.fill();
  ctx.restore();

  // Body & tail sprites.
  for (let i = 1; i < n; i++) {
    const cell = snake[i]!;
    if (i === n - 1) {
      const prev = snake[i - 1]!;
      const outgoing = dirBetween(prev, cell); // tail tip points away from the body
      drawSprite(ctx, S.tail, cell.col, cell.row, ANGLE[outgoing]);
      continue;
    }
    const toHead = dirBetween(cell, snake[i - 1]!);
    const toTail = dirBetween(cell, snake[i + 1]!);
    if (AXIS[toHead] === AXIS[toTail]) {
      // Straight: the body is authored head-east with its scale chevrons pointing tail-ward
      // (west); orient it to the run so the chevrons flow toward the tail.
      drawSprite(ctx, S.body, cell.col, cell.row, ANGLE[toHead]);
    } else {
      // Bend: orient the corner from the head/tail neighbours so its chevrons flow tail-ward
      // around the curve, continuous with the straight segments on either side.
      drawCorner(ctx, S.corner, cell.col, cell.row, toHead, toTail);
    }
  }

  // Head sheet, rotated to facing, bite frame on eat.
  const frame = Math.max(0, Math.min(S.head.length - 1, biteFrame));
  drawSprite(ctx, S.head[frame]!, head.col, head.row, ANGLE[sim.dir]);
}

// ---- HUD ----------------------------------------------------------------------

function drawHud(ctx: CanvasRenderingContext2D, game: Game, view: RenderView, dim: boolean): void {
  const sim = game.sim;
  const a = dim ? 0.5 : 1;

  // Mode tag, dim, upper-left.
  text(ctx, game.mode === "maze" ? "MAZE" : "CLASSIC", 40, 66, {
    size: 18,
    color: C.textFaint,
    spacing: 3,
    alpha: a,
  });

  // Score, left.
  text(ctx, "SCORE", 200, 44, { size: 18, color: C.textDim, spacing: 4, alpha: a });
  text(ctx, pad(sim.score), 200, 90, { size: 44, color: C.text, bold: true, spacing: 2, alpha: a });

  // Best, right.
  text(ctx, "BEST", 1080, 44, { size: 18, color: C.textDim, spacing: 4, align: "right", alpha: a });
  text(ctx, pad(game.best), 1080, 90, {
    size: 44,
    color: C.text,
    bold: true,
    spacing: 2,
    align: "right",
    alpha: a,
  });

  // Combo, centred — readout + draining window bar, shown only while M >= 2.
  if (sim.combo >= 2) {
    text(ctx, `x${sim.combo}`, 640, 70, {
      size: 34,
      color: C.combo,
      bold: true,
      align: "center",
      glow: dim ? 0 : 12,
      alpha: a,
    });
    const barW = 150;
    const barX = 640 - barW / 2;
    const barY = 86;
    ctx.save();
    ctx.globalAlpha = a;
    ctx.fillStyle = "rgba(255,210,63,0.18)";
    ctx.fillRect(barX, barY, barW, 4);
    ctx.fillStyle = C.combo;
    ctx.fillRect(barX, barY, barW * sim.comboFraction(), 4);
    ctx.restore();
  }

  // Sound toggle hint, far right.
  text(ctx, view.muted ? "MUTED [M]" : "SOUND [M]", 1240, 106, {
    size: 15,
    color: C.textFaint,
    spacing: 2,
    align: "right",
    alpha: a,
  });
}

// ---- overlay panels & screens -------------------------------------------------

function dimStage(ctx: CanvasRenderingContext2D, alpha: number): void {
  ctx.fillStyle = `rgba(11,14,20,${alpha})`;
  ctx.fillRect(0, 0, STAGE_W, STAGE_H);
}

function drawMenuList(
  ctx: CanvasRenderingContext2D,
  items: { label: string }[],
  selected: number,
  cx: number,
  topY: number,
  gap: number,
  size: number,
): void {
  for (let i = 0; i < items.length; i++) {
    const y = topY + i * gap;
    const on = i === selected;
    const label = items[i]!.label;
    text(ctx, label, cx, y, {
      size,
      color: on ? C.text : C.textDim,
      bold: on,
      align: "center",
      spacing: 4,
      glow: on ? 10 : 0,
      glowColor: C.head,
    });
    if (on) {
      // Measure with the SAME font + letter-spacing the label was drawn with (Chrome's
      // measureText honours ctx.letterSpacing), so the arrows clear the text.
      ctx.save();
      ctx.font = `bold ${size}px ${FONT}`;
      ctx.letterSpacing = "4px";
      const half = ctx.measureText(label).width / 2;
      ctx.restore();
      text(ctx, "▶", cx - half - 30, y, { size: size - 8, color: C.head, align: "center" });
      text(ctx, "◀", cx + half + 30, y, { size: size - 8, color: C.head, align: "center" });
    }
  }
}

function drawTitle(ctx: CanvasRenderingContext2D, game: Game, view: RenderView): void {
  // Faint framing panel and a dim decorative coil behind the menu.
  ctx.strokeStyle = "rgba(42,53,80,0.5)";
  ctx.lineWidth = 1;
  roundRect(ctx, 160, 118, 960, 580, 14);
  ctx.stroke();

  drawTitleFurniture(ctx, view.time);

  text(ctx, "COIL", 640, 262, { size: 150, color: C.head, bold: true, align: "center", glow: 34, spacing: 6 });
  // A decorative pellet by the title.
  const px = 878;
  const py = 296;
  const g = ctx.createRadialGradient(px, py, 1, px, py, 18);
  g.addColorStop(0, "rgba(255,92,138,0.55)");
  g.addColorStop(1, "rgba(255,92,138,0)");
  ctx.fillStyle = g;
  ctx.fillRect(px - 18, py - 18, 36, 36);
  ctx.fillStyle = C.pellet;
  ctx.beginPath();
  ctx.arc(px, py, 7, 0, Math.PI * 2);
  ctx.fill();

  text(ctx, "GRID SERPENT", 640, 358, { size: 30, color: C.textDim, align: "center", spacing: 10 });
  text(ctx, `BEST ${pad(game.best)}`, 640, 398, { size: 18, color: C.textFaint, align: "center", spacing: 5 });

  const items = menuItems("title", game);
  drawMenuList(ctx, items, game.menuIndex, 640, 484, 58, 30);

  text(ctx, "▲ ▼ MOVE     ENTER SELECT", 640, 686, {
    size: 16,
    color: C.textFaint,
    align: "center",
    spacing: 4,
  });
}

// A small dim coil + pellet behind the tagline, so the title has board furniture without a
// full board (specs/ui.md: "The board furniture … may show dimmed behind the menu").
function drawTitleFurniture(ctx: CanvasRenderingContext2D, _time: number): void {
  if (!ASSETS) return;
  ctx.save();
  ctx.globalAlpha = 0.18;
  const S = ASSETS.snake;
  const bx = 630;
  const by = 320;
  const draw = (img: HTMLImageElement, dx: number, dy: number, angle: number) => {
    ctx.save();
    ctx.translate(bx + dx + CELL / 2, by + dy + CELL / 2);
    ctx.rotate(angle);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, -CELL / 2, -CELL / 2, CELL, CELL);
    ctx.restore();
  };
  // A tiny hooked coil: a vertical run, a bend, and a stub.
  draw(S.tail, 0, -32, -Math.PI / 2);
  draw(S.body, 0, 0, Math.PI / 2);
  draw(S.corner, 0, 32, Math.PI); // opens up + left … pointing back toward the run
  draw(S.head[0]!, -32, 32, Math.PI);
  ctx.restore();
}

function drawHowto(ctx: CanvasRenderingContext2D, game: Game): void {
  ctx.strokeStyle = "rgba(42,53,80,0.5)";
  ctx.lineWidth = 1;
  roundRect(ctx, 240, 120, 800, 560, 14);
  ctx.stroke();

  text(ctx, "HOW TO PLAY", 640, 200, { size: 42, color: C.head, bold: true, align: "center", glow: 18, spacing: 4 });

  const lines: [string, string][] = [
    ["MOVE", "Arrow keys or W A S D turn the snake."],
    ["", "A turn takes effect on the next step; you"],
    ["", "can never reverse straight back on yourself."],
    ["GROW", "Eat pink pellets. Each one grows you by one"],
    ["", "cell — the longer you are, the less room."],
    ["COMBO", "Eat pellets in quick succession to build a"],
    ["", "multiplier (up to x5). It decays if you"],
    ["", "dawdle, so plan the shortest route."],
    ["PAUSE", "Esc or P pauses. M toggles sound."],
  ];
  let y = 280;
  for (const [tag, body] of lines) {
    if (tag) text(ctx, tag, 300, y, { size: 20, color: C.combo, bold: true, spacing: 2 });
    text(ctx, body, 420, y, { size: 20, color: C.textDim, spacing: 1 });
    y += 40;
  }

  const items = menuItems("howto", game);
  drawMenuList(ctx, items, game.menuIndex, 640, 640, 40, 24);
}

function drawEndPanel(ctx: CanvasRenderingContext2D, game: Game, cleared: boolean): void {
  const px = 360;
  const py = 148;
  const pw = 560;
  const ph = 420;
  ctx.fillStyle = "rgba(15,20,32,0.92)";
  roundRect(ctx, px, py, pw, ph, 16);
  ctx.fill();
  ctx.strokeStyle = "rgba(42,53,80,0.7)";
  ctx.lineWidth = 1;
  roundRect(ctx, px, py, pw, ph, 16);
  ctx.stroke();

  const cx = px + pw / 2;
  text(ctx, cleared ? "YOU WIN" : "ROUND ENDED", cx, py + 62, {
    size: 20,
    color: C.textDim,
    align: "center",
    spacing: 6,
  });
  text(ctx, cleared ? "BOARD CLEARED" : "GAME OVER", cx, py + 116, {
    size: cleared ? 48 : 56,
    color: C.head,
    bold: true,
    align: "center",
    glow: 20,
    spacing: 2,
  });
  text(ctx, `SCORE ${pad(game.sim.score)}`, cx, py + 182, {
    size: 34,
    color: C.text,
    bold: true,
    align: "center",
    spacing: 2,
  });
  text(ctx, `BEST ${pad(game.best)}`, cx, py + 226, { size: 22, color: C.textDim, align: "center", spacing: 3 });

  const items = menuItems(cleared ? "cleared" : "gameover", game);
  drawMenuList(ctx, items, game.menuIndex, cx, py + 300, 52, 30);
}

function drawPausePanel(ctx: CanvasRenderingContext2D, game: Game): void {
  const px = 400;
  const py = 190;
  const pw = 480;
  const ph = 340;
  ctx.fillStyle = "rgba(15,20,32,0.92)";
  roundRect(ctx, px, py, pw, ph, 16);
  ctx.fill();
  ctx.strokeStyle = "rgba(42,53,80,0.7)";
  ctx.lineWidth = 1;
  roundRect(ctx, px, py, pw, ph, 16);
  ctx.stroke();

  const cx = px + pw / 2;
  text(ctx, "PAUSED", cx, py + 90, { size: 46, color: C.head, bold: true, align: "center", glow: 18, spacing: 4 });
  const items = menuItems("paused", game);
  drawMenuList(ctx, items, game.menuIndex, cx, py + 168, 50, 26);
}

// ---- debug overlay ------------------------------------------------------------
//
// A read-only diagnostic layer toggled by the backtick key (specs/instrumentation.md). It
// reports the same facts snapshot() does and never changes gameplay — it only draws. Kept
// visually plain and clearly separate from the HUD.
function drawDebugOverlay(ctx: CanvasRenderingContext2D, game: Game): void {
  const s = game.debugSnapshot();
  const head = s.snake[0];
  const lines: string[] = [
    `screen  ${s.screen}   mode ${s.mode}`,
    `score   ${s.score}   best ${s.best}`,
    `combo   x${s.combo}   window ${s.comboWindow.toFixed(2)}s`,
    `dir     ${s.dir}   length ${s.length}`,
    `head    ${head ? `${head.col},${head.row}` : "-"}`,
    `pellet  ${s.pellet ? `${s.pellet.col},${s.pellet.row}` : "none"}`,
    `ticks   ${s.ticks}   sim ${s.simTime.toFixed(2)}s`,
  ];

  const padX = 14;
  const headerH = 24;
  const lineH = 20;
  const w = 320;
  const x = 24;
  const y = 130;
  const h = padX * 2 + headerH + lines.length * lineH;

  ctx.save();
  ctx.fillStyle = "rgba(7,9,14,0.82)";
  roundRect(ctx, x, y, w, h, 8);
  ctx.fill();
  ctx.strokeStyle = "rgba(42,53,80,0.9)";
  ctx.lineWidth = 1;
  roundRect(ctx, x, y, w, h, 8);
  ctx.stroke();
  ctx.restore();

  // text() draws with an alphabetic baseline, so offset each line by its size to sit it
  // inside the panel from the top.
  text(ctx, "DEBUG", x + padX, y + padX + 12, { size: 12, color: C.obstacle, bold: true, spacing: 4 });
  let ly = y + padX + headerH + 15;
  for (const line of lines) {
    text(ctx, line, x + padX, ly, { size: 15, color: C.textDim });
    ly += lineH;
  }
}

// ---- top-level frame ----------------------------------------------------------

export function render(ctx: CanvasRenderingContext2D, game: Game, view: RenderView): void {
  ctx.fillStyle = C.stageBg;
  ctx.fillRect(0, 0, STAGE_W, STAGE_H);

  switch (game.state) {
    case "title":
      drawTitle(ctx, game, view);
      break;
    case "howto":
      drawHowto(ctx, game);
      break;
    case "playing":
      drawBoard(ctx, game.sim, view);
      drawHud(ctx, game, view, false);
      break;
    case "paused":
      drawBoard(ctx, game.sim, view);
      drawHud(ctx, game, view, true);
      dimStage(ctx, 0.55);
      drawPausePanel(ctx, game);
      break;
    case "gameover":
    case "cleared":
      drawBoard(ctx, game.sim, view);
      drawHud(ctx, game, view, true);
      dimStage(ctx, 0.55);
      drawEndPanel(ctx, game, game.state === "cleared");
      break;
  }

  if (game.debugOverlay) drawDebugOverlay(ctx, game);
}
