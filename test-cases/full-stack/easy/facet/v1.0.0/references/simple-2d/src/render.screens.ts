// Facet — the screens around the board: the title, how to play, the pause menu,
// the end of a level, and the end of a round.
//
// All five are chrome and all five are drawn in code (specs/assets.md). Every
// piece of copy on them is a constant `specs/ui.md` fixes, and the highlighted
// menu item is drawn distinctly from the others so a player always sees which
// item `confirm` would accept.
//
// EVERY ROW IS DRAWN WHERE ITS TARGET IS. `specs/controls.md` gives each screen
// a set of pointer targets and requires a `menu-<i>` target to cover the drawn
// item it names, so the rows are laid out from `src/core/targets.ts` rather than
// from figures of their own: the rectangle the game hit-tests and the plate the
// player presses are the same rectangle, and neither can drift from the other.
// The `back` control on how-to-play is drawn the same way, so a player with only
// a pointer can leave a screen that carries no menu.
//
// `paused`, `levelclear`, and `gameover` draw the board first and lay a scrim
// over it, because `specs/ui.md` asks for the position to be readable behind all
// three.

import {
  BACK_LABEL,
  BEST_CHAIN_LABEL,
  BEST_MOVE_LABEL,
  GAMEOVER_ITEMS,
  GAMEOVER_TITLE_TEXT,
  GEM_KINDS,
  HUD_LEVEL_LABEL,
  HUD_SCORE_LABEL,
  LEVELCLEAR_ITEMS,
  LEVELCLEAR_TITLE_TEXT,
  PAUSED_ITEMS,
  PAUSED_TITLE_TEXT,
  STAGE_CX,
  STAGE_H,
  STAGE_W,
  TAGLINE_TEXT,
  TITLE_ITEMS,
  TITLE_TEXT,
} from "./constants";
import { targetsFor, type FacetState, type Gem, type TargetRect } from "./core";
import { drawGem } from "./render.gems";
import {
  COLOR,
  FONT_BODY,
  FONT_DISPLAY,
  drawControl,
  drawTracked,
  font,
  roundedRect,
} from "./theme";
import type { AssetStore } from "./assets";

/**
 * How to play, in a player's words rather than as rules of a system, in the
 * two columns the panel is laid out in. Between them the two columns cover
 * every point `specs/ui.md` asks the screen to make.
 */
const HOWTO_LEFT: readonly string[] = [
  "The bench holds an eight-by-eight field of cut",
  "stones in seven kinds. Take hold of a stone —",
  "with a mouse, a pen, or a finger — carry it onto",
  "the stone beside it, and let go. Letting go is",
  "what plays the move, so a stone carried back",
  "where it started plays nothing at all.",
  "",
  "Three or more of one kind in a line shatter, and",
  "a move that shatters nothing is refused: the",
  "board is left exactly as it was. Every stone",
  "beside a shattering line takes strain, and one",
  "that has taken enough is flawed — it shatters",
  "with any clear it touches, and is worth double.",
];

const HOWTO_RIGHT: readonly string[] = [
  "A line of four leaves a brilliant, which takes",
  "the ring of stones around it. A line of five or",
  "more leaves a prism, which — swapped against a",
  "stone — takes every stone of that kind. A line",
  "crossing another leaves a star, which takes its",
  "whole row and its whole column.",
  "",
  "What falls into the gap can shatter again, and",
  "each step of a chain is worth more than the one",
  "before it. Reach the level's target and the level",
  "is over. The round ends when no move is left",
  "that would shatter anything.",
];

/** The controls block under the how-to copy, naming the fixed bindings. */
const HOWTO_CONTROLS: readonly string[] = [
  "The board is played with a mouse, a pen, or a finger, and the menus answer the pointer too.",
  "UP — Up arrow          DOWN — Down arrow          CONFIRM — Enter or Space",
  "PAUSE — Esc or P          BACK — Esc          MUTE — M          Backtick — debug overlay",
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

/** The scrim the three screens over a board lay between it and their copy. */
export function drawScrim(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = COLOR.scrim;
  ctx.fillRect(0, 0, STAGE_W, STAGE_H);
}

/** The `menu-<i>` targets of a screen, in the order the items are listed in. */
export function menuTargetsOf(state: FacetState): TargetRect[] {
  return targetsFor(state.screen).filter((target) =>
    target.id.startsWith("menu-"),
  );
}

/**
 * A vertical menu, one row drawn to fill each `menu-<i>` target: the row at
 * `menuIndex` gold, larger, on a lit plate and flanked by two marks, the rest
 * dim on a plate of their own. Every row therefore covers the rectangle that
 * takes it, which is what makes the menu workable by a fingertip.
 */
export function drawMenu(
  ctx: CanvasRenderingContext2D,
  items: readonly string[],
  menuIndex: number,
  targets: readonly TargetRect[],
): void {
  ctx.textAlign = "center";
  items.forEach((item, index) => {
    const target = targets[index];
    if (!target) return;
    const highlighted = index === menuIndex;
    const cx = target.x + target.w / 2;
    const cy = target.y + target.h / 2;

    ctx.fillStyle = highlighted
      ? "rgba(246, 198, 106, 0.16)"
      : "rgba(255, 244, 220, 0.05)";
    roundedRect(ctx, target.x, target.y, target.w, target.h, 14);
    ctx.fill();
    ctx.strokeStyle = highlighted ? COLOR.gold : "rgba(246, 198, 106, 0.22)";
    ctx.lineWidth = highlighted ? 2 : 1;
    roundedRect(ctx, target.x, target.y, target.w, target.h, 14);
    ctx.stroke();

    ctx.font = font(
      highlighted ? 30 : 26,
      highlighted ? 700 : 500,
      FONT_DISPLAY,
    );
    ctx.fillStyle = highlighted ? COLOR.gold : COLOR.textDim;
    const width = drawTracked(ctx, item, cx, cy + 10, 5);
    if (!highlighted) return;
    ctx.beginPath();
    ctx.moveTo(cx - width / 2 - 34, cy);
    ctx.lineTo(cx - width / 2 - 20, cy);
    ctx.moveTo(cx + width / 2 + 20, cy);
    ctx.lineTo(cx + width / 2 + 34, cy);
    ctx.strokeStyle = COLOR.gold;
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.stroke();
  });
}

/** A label over a figure, which the two screens that tot a round up both use. */
function drawReadout(
  ctx: CanvasRenderingContext2D,
  label: string,
  value: string,
  x: number,
  labelY: number,
): void {
  ctx.font = font(16, 600, FONT_DISPLAY);
  ctx.fillStyle = COLOR.textDim;
  drawTracked(ctx, label, x, labelY, 3);
  ctx.font = font(38, 700, FONT_DISPLAY);
  ctx.fillStyle = COLOR.text;
  drawTracked(ctx, value, x, labelY + 44, 2);
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
    ...GEM_KINDS.map((kind) => ({
      kind,
      cut: "plain" as const,
      strain: 0,
      fell: 0,
    })),
    { kind: null, cut: "prism" as const, strain: 0, fell: 0 },
  ];
  const pitch = 78;
  const first = STAGE_CX - ((stones.length - 1) * pitch) / 2;
  stones.forEach((gem, index) => {
    const bob = Math.sin(state.simTime * 1.6 + index * 0.7) * 6;
    drawGem(ctx, assets, gem, first + index * pitch, 340 + bob, state.simTime);
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
  ctx.moveTo(STAGE_CX - 300, 288);
  ctx.lineTo(STAGE_CX + 300, 288);
  ctx.stroke();

  drawTitleStones(ctx, assets, state);

  drawMenu(ctx, TITLE_ITEMS, state.menuIndex, menuTargetsOf(state));

  ctx.font = font(14, 500, FONT_DISPLAY);
  ctx.fillStyle = COLOR.textDim;
  ctx.textAlign = "center";
  ctx.fillText(
    "PRESS AN ITEM, OR CHOOSE WITH THE ARROWS AND ENTER      M FOR SOUND",
    STAGE_CX,
    690,
  );
  ctx.restore();
}

/** How to play, written for a player, with the `back` control under it. */
export function drawHowToScreen(
  ctx: CanvasRenderingContext2D,
  state: FacetState,
): void {
  ctx.save();
  ctx.textBaseline = "alphabetic";
  drawPanel(ctx, 92, 56, STAGE_W - 184, 540);

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
    ctx.fillText(line, 140, 196 + index * 24);
  });
  HOWTO_RIGHT.forEach((line, index) => {
    ctx.fillText(line, 676, 196 + index * 24);
  });

  ctx.beginPath();
  ctx.moveTo(140, 508);
  ctx.lineTo(STAGE_W - 140, 508);
  ctx.stroke();

  ctx.font = font(15, 600, FONT_DISPLAY);
  ctx.fillStyle = COLOR.textDim;
  ctx.textAlign = "center";
  HOWTO_CONTROLS.forEach((line, index) => {
    ctx.fillText(line, STAGE_CX, 536 + index * 22);
  });

  for (const target of targetsFor(state.screen)) {
    if (target.id === "back") drawControl(ctx, target, BACK_LABEL);
  }
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
  drawPanel(ctx, STAGE_CX - 260, 236, 520, 348);

  ctx.font = font(52, 700, FONT_DISPLAY);
  ctx.fillStyle = COLOR.gold;
  drawTracked(ctx, PAUSED_TITLE_TEXT, STAGE_CX, 320, 14);

  drawMenu(ctx, PAUSED_ITEMS, state.menuIndex, menuTargetsOf(state));

  ctx.font = font(14, 500, FONT_DISPLAY);
  ctx.fillStyle = COLOR.textDim;
  ctx.textAlign = "center";
  ctx.fillText("ESC OR P RETURNS TO THE BOARD", STAGE_CX, 554);
  ctx.restore();
}

/**
 * The end of a level, over the board the chain left: the level just finished
 * and the two figures `specs/ui.md` measures it by, then the two choices.
 */
export function drawLevelClearScreen(
  ctx: CanvasRenderingContext2D,
  state: FacetState,
): void {
  ctx.save();
  ctx.textBaseline = "alphabetic";
  drawScrim(ctx);
  drawPanel(ctx, STAGE_CX - 300, 168, 600, 470);

  ctx.font = font(48, 700, FONT_DISPLAY);
  ctx.fillStyle = COLOR.gold;
  drawTracked(ctx, LEVELCLEAR_TITLE_TEXT, STAGE_CX, 244, 10);

  ctx.font = font(22, 500, FONT_DISPLAY);
  ctx.fillStyle = COLOR.text;
  ctx.textAlign = "center";
  drawTracked(ctx, `${HUD_LEVEL_LABEL} ${state.level}`, STAGE_CX, 288, 6);

  drawReadout(
    ctx,
    BEST_CHAIN_LABEL,
    String(state.bestChain),
    STAGE_CX - 140,
    336,
  );
  drawReadout(
    ctx,
    BEST_MOVE_LABEL,
    String(state.bestMove),
    STAGE_CX + 140,
    336,
  );

  drawMenu(ctx, LEVELCLEAR_ITEMS, state.menuIndex, menuTargetsOf(state));
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
  drawPanel(ctx, STAGE_CX - 300, 180, 600, 424);

  ctx.font = font(48, 700, FONT_DISPLAY);
  ctx.fillStyle = COLOR.gold;
  drawTracked(ctx, GAMEOVER_TITLE_TEXT, STAGE_CX, 256, 10);

  ctx.font = font(22, 500, FONT_DISPLAY);
  ctx.fillStyle = COLOR.text;
  ctx.textAlign = "center";
  ctx.fillText(
    `${HUD_SCORE_LABEL} ${state.score}      ${HUD_LEVEL_LABEL} ${state.level}`,
    STAGE_CX,
    308,
  );

  ctx.font = font(14, 500, FONT_DISPLAY);
  ctx.fillStyle = COLOR.textDim;
  ctx.fillText("ESC RETURNS TO THE TITLE", STAGE_CX, 360);

  drawMenu(ctx, GAMEOVER_ITEMS, state.menuIndex, menuTargetsOf(state));
  ctx.restore();
}
