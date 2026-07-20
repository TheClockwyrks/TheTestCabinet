// Cascade — all canvas drawing. Draws in the fixed 1280x720 logical space; the
// bootstrap sets a transform that maps it onto the backing store at any scale and
// pixel density.

import {
  COLOR,
  COLS_X,
  FACE_UP_OFFSET,
  FIELD_H,
  FIELD_W,
  FOUNDATION_X,
  STOCK_X,
  TABLEAU_Y,
  TOP_Y,
  UI_FONT,
  WASTE_X,
} from "./constants";
import {
  drawCard,
  drawHighlight,
  drawSlot,
  roundRectPath,
} from "./cards";
import type { Game } from "./game";
import {
  columnCardYs,
  hudLayout,
  titleMenu,
  wasteCardX,
  wasteFanCount,
} from "./layout";
import type { Rect } from "./types";
import { SUIT_GLYPH } from "./types";

// Empty-foundation hint pips, in slot order.
const FOUNDATION_HINTS = [
  SUIT_GLYPH.spades,
  SUIT_GLYPH.hearts,
  SUIT_GLYPH.diamonds,
  SUIT_GLYPH.clubs,
];

export function render(ctx: CanvasRenderingContext2D, game: Game): void {
  drawFelt(ctx);
  switch (game.screen) {
    case "title":
      drawTitle(ctx, game);
      break;
    case "howto":
      drawHowTo(ctx);
      break;
    case "playing":
      drawTable(ctx, game);
      break;
    case "won":
      drawWon(ctx, game);
      break;
  }

  // The read-only debug overlay draws last, over everything, when toggled on.
  if (game.debugOverlay) drawDebugOverlay(ctx, game);
}

// ---- Debug overlay -----------------------------------------------------
//
// A read-only diagnostic layer over the running game, reporting the same facts
// the debug snapshot does (specs/instrumentation.md). Toggled with the backtick
// key (see input.ts); off by default; draws only — it never changes gameplay.

function drawDebugOverlay(ctx: CanvasRenderingContext2D, game: Game): void {
  const s = game.debugSnapshot();
  const foundationCounts = s.foundations.map((f) => f.length).join(" ");
  const tableauSizes = s.tableau.map((t) => t.length).join(" ");
  const lines: string[] = [];
  lines.push(`screen  ${s.screen}    deal ${s.dealMode}  turn ${s.turnCount}`);
  lines.push(`simTime ${s.simTime.toFixed(2)}s`);
  lines.push(`stock   ${s.stock.length}    waste ${s.waste.length} (vis ${s.wasteVisibleCount})`);
  lines.push(`found   ${foundationCounts}`);
  lines.push(`tableau ${tableauSizes}`);
  if (s.drag) {
    lines.push(`drag    ${s.drag.cards.length} from ${s.drag.source.pile}`);
  } else {
    lines.push(`drag    none`);
  }
  if (s.cascade) {
    lines.push(
      `cascade launched ${s.cascade.launched}/${s.cascade.total}  inflight ${s.cascade.flyers.length}`,
    );
  }

  const pad = 14;
  const headerH = 24;
  const lineH = 20;
  const w = 360;
  const x = 24;
  const y = 24;
  const h = pad * 2 + headerH + lines.length * lineH;

  ctx.save();
  roundRectPath(ctx, x, y, w, h, 8);
  ctx.fillStyle = "rgba(6, 20, 12, 0.84)";
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = "rgba(255, 213, 74, 0.5)";
  ctx.stroke();

  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillStyle = COLOR.highlight;
  ctx.font = `700 12px ${UI_FONT}`;
  ctx.fillText("DEBUG", x + pad, y + pad);

  ctx.fillStyle = COLOR.textDim;
  ctx.font = `15px ui-monospace, "SF Mono", Menlo, Consolas, monospace`;
  let ly = y + pad + headerH;
  for (const line of lines) {
    ctx.fillText(line, x + pad, ly);
    ly += lineH;
  }
  ctx.restore();
}

// ---- Felt --------------------------------------------------------------

function drawFelt(ctx: CanvasRenderingContext2D): void {
  const g = ctx.createRadialGradient(640, 302, 120, 640, 302, 900);
  g.addColorStop(0, COLOR.felt);
  g.addColorStop(0.55, COLOR.felt);
  g.addColorStop(1, COLOR.feltShade);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, FIELD_W, FIELD_H);
}

// ---- In-game table -----------------------------------------------------

function drawTable(ctx: CanvasRenderingContext2D, game: Game): void {
  drawTopRow(ctx, game);
  drawTableau(ctx, game);
  drawDropHighlight(ctx, game);
  drawDrag(ctx, game);
  drawHud(ctx);
}

function drawTopRow(ctx: CanvasRenderingContext2D, game: Game): void {
  // Stock: a face-down card if it holds any, else an empty slot (with a recycle
  // glyph only while the waste still holds cards to recycle).
  if (game.stock.length > 0) {
    drawCard(ctx, game.stock[game.stock.length - 1], STOCK_X, TOP_Y);
  } else {
    drawSlot(ctx, STOCK_X, TOP_Y, game.waste.length > 0 ? "↻" : undefined);
  }

  // Waste: the single playable top card at the waste position; any prior cards
  // are squared beneath it (Draw One turns one card per click).
  if (game.waste.length === 0) {
    drawSlot(ctx, WASTE_X, TOP_Y);
  } else {
    const count = wasteFanCount(game.waste.length);
    const start = game.waste.length - count;
    for (let i = 0; i < count; i++) {
      drawCard(ctx, game.waste[start + i], wasteCardX(i), TOP_Y);
    }
  }

  // Foundations: the top card, or an empty slot with a dim suit-pip hint.
  for (let i = 0; i < 4; i++) {
    const f = game.foundations[i];
    if (f.length > 0) drawCard(ctx, f[f.length - 1], FOUNDATION_X[i], TOP_Y);
    else drawSlot(ctx, FOUNDATION_X[i], TOP_Y, FOUNDATION_HINTS[i]);
  }
}

function drawTableau(ctx: CanvasRenderingContext2D, game: Game): void {
  for (let col = 0; col < 7; col++) {
    const cards = game.tableau[col];
    if (cards.length === 0) {
      drawSlot(ctx, COLS_X[col], TABLEAU_Y);
      continue;
    }
    const ys = columnCardYs(cards);
    for (let i = 0; i < cards.length; i++) {
      drawCard(ctx, cards[i], COLS_X[col], ys[i]);
    }
  }
}

function drawDropHighlight(ctx: CanvasRenderingContext2D, game: Game): void {
  if (game.dropHighlight) {
    drawHighlight(ctx, game.dropHighlight.x, game.dropHighlight.y);
  }
}

function drawDrag(ctx: CanvasRenderingContext2D, game: Game): void {
  const drag = game.drag;
  if (!drag) return;
  // The held run floats above the table with a lifted shadow, stacked at the
  // natural face-up offset.
  for (let i = 0; i < drag.cards.length; i++) {
    drawCard(ctx, drag.cards[i], drag.x, drag.y + i * FACE_UP_OFFSET, {
      shadow: "lifted",
    });
  }
}

// ---- HUD ---------------------------------------------------------------

function drawHud(ctx: CanvasRenderingContext2D): void {
  const hud = hudLayout();
  drawButton(ctx, hud.newGame, "NEW GAME");
  drawButton(ctx, hud.menu, "MENU");

  ctx.save();
  ctx.fillStyle = COLOR.textDim;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `14px ${UI_FONT}`;
  drawSpacedText(ctx, "DRAW ONE", hud.modeLabel.cx, hud.modeLabel.cy, 4);
  ctx.restore();
}

function drawButton(ctx: CanvasRenderingContext2D, r: Rect, label: string): void {
  ctx.save();
  roundRectPath(ctx, r.x, r.y, r.w, r.h, 8);
  ctx.fillStyle = "rgba(0, 0, 0, 0.14)";
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = "rgba(255, 255, 255, 0.25)";
  ctx.stroke();
  ctx.fillStyle = COLOR.text;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `16px ${UI_FONT}`;
  drawSpacedText(ctx, label, r.x + r.w / 2, r.y + r.h / 2 + 1, 3);
  ctx.restore();
}

// ---- Title -------------------------------------------------------------

function drawTitle(ctx: CanvasRenderingContext2D, game: Game): void {
  // Dim the felt behind the menu.
  ctx.fillStyle = COLOR.overlay;
  ctx.fillRect(0, 0, FIELD_W, FIELD_H);

  ctx.save();
  ctx.textAlign = "center";

  // Title.
  ctx.fillStyle = COLOR.text;
  ctx.textBaseline = "alphabetic";
  ctx.shadowColor = "rgba(0, 0, 0, 0.45)";
  ctx.shadowBlur = 24;
  ctx.shadowOffsetY = 4;
  ctx.font = `800 128px ${UI_FONT}`;
  drawSpacedText(ctx, "CASCADE", 640, 290, 14);
  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;

  // Tagline.
  ctx.fillStyle = COLOR.textDim;
  ctx.font = `22px ${UI_FONT}`;
  drawSpacedText(ctx, "KLONDIKE SOLITAIRE", 640, 346, 12);

  // Mode badge (a pill).
  drawModeBadge(ctx, "DRAW ONE", 640, 387);

  // Menu.
  const menu = titleMenu();
  ctx.font = `30px ${UI_FONT}`;
  for (let i = 0; i < menu.length; i++) {
    const selected = i === game.menuIndex;
    ctx.fillStyle = selected ? COLOR.highlight : COLOR.textDim;
    const label = selected ? "▸  " + menu[i].label : menu[i].label;
    drawSpacedText(ctx, label, menu[i].cx, menu[i].cy + 10, 8);
  }

  // Hint line.
  ctx.fillStyle = COLOR.textDim;
  ctx.font = `15px ${UI_FONT}`;
  drawSpacedText(ctx, "CLICK A CARD AND DRAG IT HOME", 640, FIELD_H - 34, 6);

  ctx.restore();
}

function drawModeBadge(
  ctx: CanvasRenderingContext2D,
  label: string,
  cx: number,
  cy: number,
): void {
  ctx.save();
  ctx.font = `16px ${UI_FONT}`;
  const spacing = 6;
  const w = spacedWidth(ctx, label, spacing);
  const padX = 16;
  const boxW = w + padX * 2;
  const boxH = 34;
  const x = cx - boxW / 2;
  const y = cy - boxH / 2;
  roundRectPath(ctx, x, y, boxW, boxH, boxH / 2);
  ctx.lineWidth = 1;
  ctx.strokeStyle = "rgba(255, 213, 74, 0.5)";
  ctx.stroke();
  ctx.fillStyle = COLOR.highlight;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  drawSpacedText(ctx, label, cx, cy + 1, spacing);
  ctx.restore();
}

// ---- How to play -------------------------------------------------------

function drawHowTo(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = COLOR.overlay;
  ctx.fillRect(0, 0, FIELD_W, FIELD_H);

  ctx.save();
  ctx.textAlign = "center";
  ctx.fillStyle = COLOR.text;
  ctx.font = `800 56px ${UI_FONT}`;
  drawSpacedText(ctx, "HOW TO PLAY", 640, 130, 8);

  ctx.font = `20px ${UI_FONT}`;
  ctx.fillStyle = COLOR.textDim;
  const lines = [
    "Goal: build the four foundations up from Ace to King, one suit each.",
    "",
    "Tableau builds down in rank, alternating color (red on black, black on red).",
    "Only a King (or a King-headed run) may move onto an empty column.",
    "A face-up run moves as a unit; an illegal drop returns to where it started.",
    "",
    "Click the stock to turn one card to the waste; click it empty to recycle.",
    "Drag a card or run to move it; double-click a card to send it home.",
    "",
    "Mode: DRAW ONE — the stock turns one card at a time.",
    "Keys: N new game · Esc menu.",
  ];
  let y = 210;
  for (const line of lines) {
    if (line) ctx.fillText(line, 640, y);
    y += 34;
  }

  ctx.fillStyle = COLOR.textDim;
  ctx.font = `15px ${UI_FONT}`;
  drawSpacedText(ctx, "CLICK ANYWHERE TO RETURN", 640, FIELD_H - 48, 6);
  ctx.restore();
}

// ---- Won / cascade -----------------------------------------------------

function drawWon(ctx: CanvasRenderingContext2D, game: Game): void {
  const sim = game.cascade;
  // The emptying foundations remain drawn in place beneath the accumulating
  // trail; the stock and waste are empty.
  drawSlot(ctx, STOCK_X, TOP_Y);
  drawSlot(ctx, WASTE_X, TOP_Y);
  if (sim) {
    const remaining = sim.remaining;
    for (let i = 0; i < 4; i++) {
      const f = remaining[i];
      if (f.length > 0) drawCard(ctx, f[f.length - 1], FOUNDATION_X[i], TOP_Y);
      else drawSlot(ctx, FOUNDATION_X[i], TOP_Y, FOUNDATION_HINTS[i]);
    }
  }

  // The persistent painted trail, on top of the felt and foundations.
  ctx.drawImage(game.trailCanvas, 0, 0, FIELD_W, FIELD_H);

  // Once the cascade completes, show the YOU WIN banner.
  if (game.cascadeDone) drawWinBanner(ctx);
}

function drawWinBanner(ctx: CanvasRenderingContext2D): void {
  ctx.save();
  const cx = 640;
  const cy = FIELD_H * 0.4;
  const boxW = 500;
  const boxH = 176;
  const x = cx - boxW / 2;
  const y = cy - boxH / 2;
  ctx.shadowColor = "rgba(0, 0, 0, 0.5)";
  ctx.shadowBlur = 70;
  ctx.shadowOffsetY = 24;
  roundRectPath(ctx, x, y, boxW, boxH, 16);
  ctx.fillStyle = COLOR.banner;
  ctx.fill();
  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
  ctx.lineWidth = 1;
  ctx.strokeStyle = "rgba(255, 213, 74, 0.5)";
  ctx.stroke();

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = COLOR.highlight;
  ctx.font = `800 64px ${UI_FONT}`;
  drawSpacedText(ctx, "YOU WIN", cx, cy - 18, 12);
  ctx.fillStyle = COLOR.textDim;
  ctx.font = `16px ${UI_FONT}`;
  drawSpacedText(ctx, "CLICK FOR A NEW GAME", cx, cy + 34, 5);
  ctx.restore();
}

// ---- Letter-spaced text ------------------------------------------------
//
// Canvas has no letter-spacing, and the reference type is spaced out, so draw
// each glyph and advance by its width plus a fixed tracking value.

function spacedWidth(
  ctx: CanvasRenderingContext2D,
  text: string,
  spacing: number,
): number {
  let w = 0;
  for (const ch of text) w += ctx.measureText(ch).width + spacing;
  return w - spacing;
}

function drawSpacedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  cx: number,
  cy: number,
  spacing: number,
): void {
  const total = spacedWidth(ctx, text, spacing);
  const prevAlign = ctx.textAlign;
  ctx.textAlign = "left";
  let x = cx - total / 2;
  for (const ch of text) {
    const w = ctx.measureText(ch).width;
    ctx.fillText(ch, x, cy);
    x += w + spacing;
  }
  ctx.textAlign = prevAlign;
}
