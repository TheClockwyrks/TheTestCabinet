// Cascade — the four screens and the HUD, drawn (specs/screens.md).
//
// Like `src/render.ts`, everything here is a pure read of the state it is
// handed. The HUD draws on the `playing` screen alone, inside the strip
// `specs/table.md` fixes, so it never overlaps a pile; the title and how-to
// screens draw a near-opaque scrim over the whole stage, so the table shows
// faintly behind them and every string is read against one known background;
// the won screen draws `WIN_TEXT` over the painted table once the cascade is
// done.
//
// Every literal drawn here comes from `src/constants.ts`, which is where the
// specification's screen copy is fixed.

import {
  DEAL_MODE_LABEL,
  HOWTO_BACK,
  HOWTO_BACK_LABEL,
  HUD_H,
  HUD_ITEMS,
  HUD_MENU,
  HUD_NEW_GAME,
  HUD_SOUND,
  HUD_Y,
  STAGE_H,
  STAGE_W,
  TAGLINE_TEXT,
  TITLE_HOW_TO,
  TITLE_ITEMS,
  TITLE_NEW_GAME,
  TITLE_TEXT,
  WIN_TEXT,
  type Rect,
} from "./constants";
import type { CascadeState } from "./game";
import { COLOR, font, withAlpha } from "./theme";

type Ctx = CanvasRenderingContext2D;

/** One labelled control: a plate the label is drawn centered inside. */
function drawControl(ctx: Ctx, rect: Rect, label: string, size: number): void {
  ctx.fillStyle = COLOR.hud;
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  ctx.strokeStyle = COLOR.hudEdge;
  ctx.lineWidth = 2;
  ctx.strokeRect(rect.x + 1, rect.y + 1, rect.w - 2, rect.h - 2);

  ctx.fillStyle = COLOR.text;
  ctx.font = font(size);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, rect.x + rect.w / 2, rect.y + rect.h / 2);
}

/** The HUD strip: its three controls and the deal-mode label, during play. */
export function renderHud(state: CascadeState, ctx: Ctx): void {
  if (state.screen !== "playing") return;

  ctx.fillStyle = COLOR.hud;
  ctx.fillRect(0, HUD_Y, STAGE_W, HUD_H);
  ctx.strokeStyle = COLOR.hudEdge;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, HUD_Y + 1);
  ctx.lineTo(STAGE_W, HUD_Y + 1);
  ctx.stroke();

  drawControl(ctx, HUD_NEW_GAME, HUD_ITEMS[0], 20);
  drawControl(ctx, HUD_MENU, HUD_ITEMS[1], 20);
  drawControl(ctx, HUD_SOUND, HUD_ITEMS[2], 20);

  ctx.fillStyle = COLOR.dim;
  ctx.font = font(20);
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  ctx.fillText(DEAL_MODE_LABEL, STAGE_W - 24, HUD_Y + HUD_H / 2);
}

/** The near-opaque backdrop the title and how-to screens are read against. */
function drawScrim(ctx: Ctx): void {
  ctx.fillStyle = withAlpha(COLOR.panel, 0.94);
  ctx.fillRect(0, 0, STAGE_W, STAGE_H);
}

function drawTitle(ctx: Ctx): void {
  drawScrim(ctx);

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  ctx.fillStyle = COLOR.text;
  ctx.font = font(104, 800);
  ctx.fillText(TITLE_TEXT, STAGE_W / 2, 216);

  ctx.fillStyle = COLOR.dim;
  ctx.font = font(30);
  ctx.fillText(TAGLINE_TEXT, STAGE_W / 2, 300);

  ctx.fillStyle = COLOR.highlight;
  ctx.font = font(24);
  ctx.fillText(DEAL_MODE_LABEL, STAGE_W / 2, 366);

  drawControl(ctx, TITLE_NEW_GAME, TITLE_ITEMS[0], 26);
  drawControl(ctx, TITLE_HOW_TO, TITLE_ITEMS[1], 26);
}

/**
 * How to play, in a player's words. Each of the four standalone tokens
 * `specs/screens.md` fixes — `ACE`, `KING`, `STOCK` and `DOUBLE-CLICK` — is
 * carried by one of these lines.
 */
const HOWTO_LINES: readonly string[] = [
  "Build all four foundations up from the ACE to the KING,",
  "one suit on each of them, and the game is won.",
  "",
  "Columns build downward in alternating colors, and only a",
  "KING moves onto an empty column.",
  "",
  "Turn cards off the STOCK onto the waste, and turn the empty",
  "stock again to pass through the same cards once more.",
  "",
  "Drag a card, or the run beneath it, onto the pile it belongs",
  "on. DOUBLE-CLICK a card to send it straight home.",
];

function drawHowTo(ctx: Ctx): void {
  drawScrim(ctx);

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  ctx.fillStyle = COLOR.text;
  ctx.font = font(56, 800);
  ctx.fillText("HOW TO PLAY", STAGE_W / 2, 108);

  ctx.font = font(24, 500);
  HOWTO_LINES.forEach((line, index) => {
    if (line === "") return;
    ctx.fillStyle = COLOR.dim;
    ctx.fillText(line, STAGE_W / 2, 186 + index * 34);
  });

  drawControl(ctx, HOWTO_BACK, HOWTO_BACK_LABEL, 26);
}

function drawWon(state: CascadeState, ctx: Ctx): void {
  if (!state.cascadeDone) return;

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const plateW = 620;
  const plateH = 180;
  ctx.fillStyle = withAlpha(COLOR.panel, 0.88);
  ctx.fillRect((STAGE_W - plateW) / 2, (STAGE_H - plateH) / 2, plateW, plateH);
  ctx.strokeStyle = COLOR.highlight;
  ctx.lineWidth = 4;
  ctx.strokeRect(
    (STAGE_W - plateW) / 2 + 2,
    (STAGE_H - plateH) / 2 + 2,
    plateW - 4,
    plateH - 4,
  );

  ctx.fillStyle = COLOR.text;
  ctx.font = font(88, 800);
  ctx.fillText(WIN_TEXT, STAGE_W / 2, STAGE_H / 2 - 16);

  ctx.fillStyle = COLOR.dim;
  ctx.font = font(22, 500);
  ctx.fillText("Click anywhere for a new game", STAGE_W / 2, STAGE_H / 2 + 52);
}

/** Whichever of the four screens is up, drawn over the table. */
export function renderScreens(state: CascadeState, ctx: Ctx): void {
  switch (state.screen) {
    case "title":
      drawTitle(ctx);
      return;
    case "howto":
      drawHowTo(ctx);
      return;
    case "playing":
      return;
    case "won":
      drawWon(state, ctx);
      return;
  }
}
