// Facet — the screens around the board: the title, how to play, the pause
// menu, and the end of a round.
//
// All four are chrome and all four are drawn in code (specs/assets.md). Every
// piece of copy on them is a constant `specs/ui.md` fixes, and the highlighted
// menu item is drawn distinctly from the others so a player always sees which
// item `confirm` would accept.
//
// `paused` and `gameover` draw the board first and lay a scrim over it, because
// `specs/ui.md` asks for the position to be readable behind both.

import {
  GAMEOVER_ITEMS,
  GAMEOVER_TITLE_TEXT,
  GEM_KINDS,
  PAUSED_ITEMS,
  PAUSED_TITLE_TEXT,
  STAGE_CX,
  STAGE_H,
  STAGE_W,
  TAGLINE_TEXT,
  TITLE_ITEMS,
  TITLE_TEXT,
} from "./constants";
import { drawGem } from "./render.gems";
import {
  COLOR,
  FONT_BODY,
  FONT_DISPLAY,
  drawTracked,
  font,
  roundedRect,
} from "./theme";
import type { AssetStore } from "./assets";
import type { FacetState, Gem } from "./core";

/**
 * How to play, in a player's words rather than as rules of a system, in the
 * two columns the panel is laid out in. Between them the two columns cover
 * every point `specs/ui.md` asks the screen to make.
 */
const HOWTO_LEFT: readonly string[] = [
  "The bench holds an eight-by-eight field of cut",
  "stones in seven kinds. Swap a stone with the one",
  "beside it — with the pointer, or with the arrow",
  "keys and Enter. A swap that shatters nothing is",
  "refused, and the board is left exactly as it was.",
  "",
  "Three or more of one kind in a line shatter.",
  "Every stone beside a shattering line takes",
  "strain, and a stone that has taken enough of it",
  "is flawed: it shatters along with any clear that",
  "touches it, and it is worth double. A swap made",
  "beside a worn stretch of board runs on and on.",
];

const HOWTO_RIGHT: readonly string[] = [
  "A line of four leaves a brilliant, which takes the",
  "ring of stones around it. A line of five or more",
  "leaves a prism, which — swapped against a stone",
  "— takes every stone of that kind. A line crossing",
  "another leaves a star, which takes its whole row",
  "and its whole column.",
  "",
  "What falls into the gap can shatter again, and",
  "each step of a chain is worth more than the one",
  "before it. Reach the level's target and the next",
  "level opens. The round ends when no swap is left",
  "that would shatter anything.",
];

/** The controls block under the how-to copy, naming the fixed bindings. */
const HOWTO_CONTROLS: readonly string[] = [
  "ARROWS or WASD — move the cursor          ENTER or SPACE — select, then swap",
  "POINTER — press a stone, then press or drag onto the one beside it",
  "P — pause          M — sound on and off          ` — debug overlay",
];

/** A rounded panel with a brass edge, which every menu screen sits on. */
export function drawPanel(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  ctx.fillStyle = COLOR.panel;
  roundedRect(ctx, x, y, width, height, 18);
  ctx.fill();
  ctx.strokeStyle = COLOR.panelEdge;
  ctx.lineWidth = 2;
  roundedRect(ctx, x, y, width, height, 18);
  ctx.stroke();
}

/** The scrim `paused` and `gameover` lay over the board behind them. */
export function drawScrim(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = COLOR.scrim;
  ctx.fillRect(0, 0, STAGE_W, STAGE_H);
}

/**
 * A vertical menu, stacked from `y`, with the item at `menuIndex` highlighted:
 * gold, larger, and flanked by two marks, against dim, plain text.
 */
export function drawMenu(
  ctx: CanvasRenderingContext2D,
  items: readonly string[],
  menuIndex: number,
  y: number,
  spacing: number,
): void {
  ctx.textAlign = "center";
  items.forEach((item, index) => {
    const highlighted = index === menuIndex;
    ctx.font = font(
      highlighted ? 30 : 26,
      highlighted ? 700 : 500,
      FONT_DISPLAY,
    );
    ctx.fillStyle = highlighted ? COLOR.gold : COLOR.textDim;
    const at = y + index * spacing;
    const width = drawTracked(ctx, item, STAGE_CX, at, 5);
    if (!highlighted) return;
    ctx.beginPath();
    ctx.moveTo(STAGE_CX - width / 2 - 34, at - 9);
    ctx.lineTo(STAGE_CX - width / 2 - 20, at - 9);
    ctx.moveTo(STAGE_CX + width / 2 + 20, at - 9);
    ctx.lineTo(STAGE_CX + width / 2 + 34, at - 9);
    ctx.strokeStyle = COLOR.gold;
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.stroke();
  });
}

/**
 * The row of stones under the title: one of each kind and the turning prism,
 * bobbing on game time so the title screen is alive and shows the art the
 * board is played with.
 */
function drawTitleStones(
  ctx: CanvasRenderingContext2D,
  assets: AssetStore,
  state: FacetState,
): void {
  const stones: Gem[] = [
    ...GEM_KINDS.map((kind) => ({ kind, cut: "plain" as const, strain: 0 })),
    { kind: null, cut: "prism" as const, strain: 0 },
  ];
  const pitch = 78;
  const first = STAGE_CX - ((stones.length - 1) * pitch) / 2;
  stones.forEach((gem, index) => {
    const bob = Math.sin(state.simTime * 1.6 + index * 0.7) * 7;
    drawGem(ctx, assets, gem, first + index * pitch, 392 + bob, state.simTime);
  });
}

/** The title screen: the title, the tagline, the stones, and the menu. */
export function drawTitleScreen(
  ctx: CanvasRenderingContext2D,
  assets: AssetStore,
  state: FacetState,
): void {
  ctx.save();
  ctx.textBaseline = "alphabetic";

  ctx.font = font(108, 700, FONT_DISPLAY);
  ctx.fillStyle = COLOR.gold;
  drawTracked(ctx, TITLE_TEXT, STAGE_CX, 214, 26);

  ctx.font = font(22, 500, FONT_DISPLAY);
  ctx.fillStyle = COLOR.textDim;
  drawTracked(ctx, TAGLINE_TEXT, STAGE_CX, 262, 8);

  ctx.strokeStyle = COLOR.goldDim;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(STAGE_CX - 300, 292);
  ctx.lineTo(STAGE_CX + 300, 292);
  ctx.stroke();

  drawTitleStones(ctx, assets, state);

  drawMenu(ctx, TITLE_ITEMS, state.menuIndex, 520, 56);

  ctx.font = font(14, 500, FONT_DISPLAY);
  ctx.fillStyle = COLOR.textDim;
  ctx.textAlign = "center";
  ctx.fillText(
    "ARROWS to choose      ENTER to accept      M for sound",
    STAGE_CX,
    668,
  );
  ctx.restore();
}

/** How to play, written for a player. `back` returns to the title. */
export function drawHowToScreen(ctx: CanvasRenderingContext2D): void {
  ctx.save();
  ctx.textBaseline = "alphabetic";
  drawPanel(ctx, 92, 56, STAGE_W - 184, STAGE_H - 112);

  ctx.font = font(40, 700, FONT_DISPLAY);
  ctx.fillStyle = COLOR.gold;
  drawTracked(ctx, "HOW TO PLAY", STAGE_CX, 126, 10);

  ctx.strokeStyle = COLOR.goldDim;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(140, 154);
  ctx.lineTo(STAGE_W - 140, 154);
  ctx.stroke();

  ctx.font = font(17, 400, FONT_BODY);
  ctx.fillStyle = COLOR.text;
  ctx.textAlign = "left";
  HOWTO_LEFT.forEach((line, index) => {
    ctx.fillText(line, 140, 200 + index * 26);
  });
  HOWTO_RIGHT.forEach((line, index) => {
    ctx.fillText(line, 676, 200 + index * 26);
  });

  ctx.beginPath();
  ctx.moveTo(140, 532);
  ctx.lineTo(STAGE_W - 140, 532);
  ctx.stroke();

  ctx.font = font(15, 600, FONT_DISPLAY);
  ctx.fillStyle = COLOR.textDim;
  ctx.textAlign = "center";
  HOWTO_CONTROLS.forEach((line, index) => {
    ctx.fillText(line, STAGE_CX, 568 + index * 24);
  });

  ctx.font = font(16, 700, FONT_DISPLAY);
  ctx.fillStyle = COLOR.gold;
  ctx.fillText("ESC — BACK", STAGE_CX, 648);
  ctx.restore();
}

/** The pause menu, over the board it holds. */
export function drawPausedScreen(
  ctx: CanvasRenderingContext2D,
  state: FacetState,
): void {
  ctx.save();
  ctx.textBaseline = "alphabetic";
  drawScrim(ctx);
  drawPanel(ctx, STAGE_CX - 260, 218, 520, 284);

  ctx.font = font(52, 700, FONT_DISPLAY);
  ctx.fillStyle = COLOR.gold;
  drawTracked(ctx, PAUSED_TITLE_TEXT, STAGE_CX, 300, 14);

  drawMenu(ctx, PAUSED_ITEMS, state.menuIndex, 380, 54);

  ctx.font = font(14, 500, FONT_DISPLAY);
  ctx.fillStyle = COLOR.textDim;
  ctx.textAlign = "center";
  ctx.fillText("P or ESC to resume", STAGE_CX, 476);
  ctx.restore();
}

/** The end of a round: the final score and level, and the two choices. */
export function drawGameOverScreen(
  ctx: CanvasRenderingContext2D,
  state: FacetState,
): void {
  ctx.save();
  ctx.textBaseline = "alphabetic";
  drawScrim(ctx);
  drawPanel(ctx, STAGE_CX - 300, 178, 600, 364);

  ctx.font = font(48, 700, FONT_DISPLAY);
  ctx.fillStyle = COLOR.gold;
  drawTracked(ctx, GAMEOVER_TITLE_TEXT, STAGE_CX, 256, 10);

  ctx.font = font(22, 500, FONT_DISPLAY);
  ctx.fillStyle = COLOR.text;
  ctx.textAlign = "center";
  ctx.fillText(`SCORE ${state.score}      LEVEL ${state.level}`, STAGE_CX, 308);

  drawMenu(ctx, GAMEOVER_ITEMS, state.menuIndex, 388, 54);

  ctx.font = font(14, 500, FONT_DISPLAY);
  ctx.fillStyle = COLOR.textDim;
  ctx.textAlign = "center";
  ctx.fillText("ESC returns to the title", STAGE_CX, 508);
  ctx.restore();
}
