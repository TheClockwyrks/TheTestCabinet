// Facet — the screens around the board: the title, how to play, the pause menu,
// the end of a level, and the end of a round.
//
// All five are chrome and all five are drawn in code (specs/assets.md). Every
// piece of copy on them is a constant `specs/ui.md` fixes, and the highlighted
// menu item is drawn distinctly from the others so a player always sees which
// item `confirm` would accept.
//
// EVERY MENU ROW AND EVERY CONTROL IS DRAWN ON ITS OWN POINTER TARGET. The
// rectangles come from `src/core/targets.ts`, which is also what the game
// hit-tests a press against (specs/controls.md), so the drawn row a player aims
// at IS the target their release takes — there is no second set of numbers here
// to drift out of step with the first, and every row is a fingertip's worth of
// stage.
//
// `paused`, `levelclear`, and `gameover` draw the board first and lay a scrim
// over it, because `specs/ui.md` asks for the position to be readable behind
// all three.

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
import { targetsFor } from "./core";
import { drawGem } from "./render.gems";
import {
  COLOR,
  FONT_BODY,
  FONT_DISPLAY,
  drawControl,
  drawPlate,
  drawTracked,
  font,
  roundedRect,
} from "./theme";
import type { AssetStore } from "./assets";
import type { FacetState, Screen } from "./game";
import type { GemLook } from "./render.gems";

/**
 * How to play, in a player's words rather than as rules of a system, in the
 * two columns the panel is laid out in. Between them the two columns cover
 * every point `specs/ui.md` asks the screen to make.
 */
const HOWTO_LEFT: readonly string[] = [
  "The bench holds an eight-by-eight field of cut",
  "stones in seven kinds. Press one to take hold of",
  "it, carry it onto the stone beside it, and let go.",
  "The release is what plays the move, so carrying",
  "it back where it started plays nothing.",
  "",
  "Three or more of one kind in a line shatter. A",
  "move that shatters nothing is refused, and the",
  "board is left exactly as it was.",
  "",
  "Every stone beside a shattering line takes strain,",
  "and a stone that has taken enough of it is flawed:",
  "it shatters with any clear it touches, for double.",
];

const HOWTO_RIGHT: readonly string[] = [
  "A line of four leaves a brilliant, which takes the",
  "ring of stones around it. A line of five or more",
  "leaves a prism, which — swapped against a stone —",
  "takes every stone of that kind. A line crossing",
  "another leaves a star, which takes its whole row",
  "and its whole column.",
  "",
  "What falls into the gap can shatter again, and",
  "each step of a chain is worth more than the one",
  "before it. Reach the level's target and the level",
  "is over. The round ends when no move is left that",
  "would shatter anything.",
];

/** The controls block under the how-to copy, naming the fixed bindings. */
const HOWTO_CONTROLS: readonly string[] = [
  "MOUSE, PEN or FINGER — take hold of a stone, and work every screen",
  "UP and DOWN ARROWS — move the highlight          ENTER or SPACE — choose",
  "ESC or P — pause          ESC — back          M — sound          ` — debug overlay",
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

/** The scrim the three screens with a board behind them lay over it. */
export function drawScrim(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = COLOR.scrim;
  ctx.fillRect(0, 0, STAGE_W, STAGE_H);
}

/**
 * A vertical menu, one row per item, each drawn ON the `menu-<i>` pointer
 * target `src/core/targets.ts` reports for the screen. The item at `menuIndex`
 * is gold on a brass-edged plate against the dim plates of the others, so a
 * player always sees which item `confirm` would accept and which row a release
 * would take.
 */
export function drawMenu(
  ctx: CanvasRenderingContext2D,
  screen: Screen,
  items: readonly string[],
  menuIndex: number,
): void {
  const targets = targetsFor(screen);
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  items.forEach((item, index) => {
    const rect = targets.find((target) => target.id === `menu-${index}`);
    if (rect === undefined) return;
    const picked = index === menuIndex;
    drawPlate(ctx, rect, picked);
    ctx.font = font(picked ? 30 : 26, picked ? 700 : 500, FONT_DISPLAY);
    ctx.fillStyle = picked ? COLOR.gold : COLOR.textDim;
    drawTracked(ctx, item, rect.x + rect.w / 2, rect.y + rect.h / 2 + 10, 5);
  });
}

/** The one control a screen carries, drawn on the target it is worked through. */
function drawScreenControl(
  ctx: CanvasRenderingContext2D,
  screen: Screen,
  id: string,
  label: string,
): void {
  for (const target of targetsFor(screen)) {
    if (target.id === id) drawControl(ctx, target, label);
  }
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
  const stones: GemLook[] = [
    ...GEM_KINDS.map((kind) => ({ kind, cut: "plain" as const, strain: 0 })),
    { kind: null, cut: "prism" as const, strain: 0 },
  ];
  const pitch = 78;
  const first = STAGE_CX - ((stones.length - 1) * pitch) / 2;
  stones.forEach((gem, index) => {
    const bob = Math.sin(state.simTime * 1.6 + index * 0.7) * 7;
    drawGem(ctx, assets, gem, first + index * pitch, 336 + bob, state.simTime);
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
  drawTracked(ctx, TITLE_TEXT, STAGE_CX, 190, 26);

  ctx.font = font(22, 500, FONT_DISPLAY);
  ctx.fillStyle = COLOR.textDim;
  drawTracked(ctx, TAGLINE_TEXT, STAGE_CX, 238, 8);

  ctx.strokeStyle = COLOR.goldDim;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(STAGE_CX - 300, 266);
  ctx.lineTo(STAGE_CX + 300, 266);
  ctx.stroke();

  drawTitleStones(ctx, assets, state);

  drawMenu(ctx, "title", TITLE_ITEMS, state.menuIndex);

  ctx.font = font(14, 500, FONT_DISPLAY);
  ctx.fillStyle = COLOR.textDim;
  ctx.textAlign = "center";
  ctx.fillText(
    "PRESS AN ITEM, or ARROWS to choose and ENTER to accept      M for sound",
    STAGE_CX,
    620,
  );
  ctx.restore();
}

/** How to play, written for a player. The `BACK` control returns to the title. */
export function drawHowToScreen(ctx: CanvasRenderingContext2D): void {
  ctx.save();
  ctx.textBaseline = "alphabetic";
  drawPanel(ctx, 92, 28, STAGE_W - 184, 676);

  ctx.font = font(38, 700, FONT_DISPLAY);
  ctx.fillStyle = COLOR.gold;
  drawTracked(ctx, "HOW TO PLAY", STAGE_CX, 92, 10);

  ctx.strokeStyle = COLOR.goldDim;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(140, 116);
  ctx.lineTo(STAGE_W - 140, 116);
  ctx.stroke();

  ctx.font = font(17, 400, FONT_BODY);
  ctx.fillStyle = COLOR.text;
  ctx.textAlign = "left";
  HOWTO_LEFT.forEach((line, index) => {
    ctx.fillText(line, 140, 152 + index * 24);
  });
  HOWTO_RIGHT.forEach((line, index) => {
    ctx.fillText(line, 676, 152 + index * 24);
  });

  ctx.beginPath();
  ctx.moveTo(140, 462);
  ctx.lineTo(STAGE_W - 140, 462);
  ctx.stroke();

  ctx.font = font(15, 600, FONT_DISPLAY);
  ctx.fillStyle = COLOR.textDim;
  ctx.textAlign = "center";
  HOWTO_CONTROLS.forEach((line, index) => {
    ctx.fillText(line, STAGE_CX, 494 + index * 24);
  });

  drawScreenControl(ctx, "howto", "back", BACK_LABEL);
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
  drawPanel(ctx, STAGE_CX - 260, 236, 520, 340);

  ctx.font = font(52, 700, FONT_DISPLAY);
  ctx.fillStyle = COLOR.gold;
  drawTracked(ctx, PAUSED_TITLE_TEXT, STAGE_CX, 316, 14);

  drawMenu(ctx, "paused", PAUSED_ITEMS, state.menuIndex);

  ctx.font = font(14, 500, FONT_DISPLAY);
  ctx.fillStyle = COLOR.textDim;
  ctx.textAlign = "center";
  ctx.fillText("ESC or P to resume", STAGE_CX, 556);
  ctx.restore();
}

/** One labeled figure of a finished level, centered on `x`. */
function drawLevelFigure(
  ctx: CanvasRenderingContext2D,
  label: string,
  value: number,
  x: number,
): void {
  ctx.font = font(15, 600, FONT_DISPLAY);
  ctx.fillStyle = COLOR.textDim;
  drawTracked(ctx, label, x, 350, 3);
  ctx.font = font(40, 700, FONT_DISPLAY);
  ctx.fillStyle = COLOR.text;
  ctx.textAlign = "center";
  ctx.fillText(String(value), x, 398);
}

/**
 * The end of a level: what the level was measured by, and the two choices.
 * `specs/ui.md` fixes both figures — the deepest chain step the level reached
 * and the most points one move scored in it — and the level just finished.
 */
export function drawLevelClearScreen(
  ctx: CanvasRenderingContext2D,
  state: FacetState,
): void {
  ctx.save();
  ctx.textBaseline = "alphabetic";
  drawScrim(ctx);
  drawPanel(ctx, STAGE_CX - 320, 178, 640, 460);

  ctx.font = font(48, 700, FONT_DISPLAY);
  ctx.fillStyle = COLOR.gold;
  drawTracked(ctx, LEVELCLEAR_TITLE_TEXT, STAGE_CX, 250, 10);

  ctx.font = font(22, 500, FONT_DISPLAY);
  ctx.fillStyle = COLOR.text;
  ctx.textAlign = "center";
  ctx.fillText(`${HUD_LEVEL_LABEL} ${state.level}`, STAGE_CX, 296);

  drawLevelFigure(ctx, BEST_CHAIN_LABEL, state.bestChain, STAGE_CX - 150);
  drawLevelFigure(ctx, BEST_MOVE_LABEL, state.bestMove, STAGE_CX + 150);

  drawMenu(ctx, "levelclear", LEVELCLEAR_ITEMS, state.menuIndex);
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
  drawPanel(ctx, STAGE_CX - 300, 178, 600, 460);

  ctx.font = font(48, 700, FONT_DISPLAY);
  ctx.fillStyle = COLOR.gold;
  drawTracked(ctx, GAMEOVER_TITLE_TEXT, STAGE_CX, 256, 10);

  ctx.font = font(22, 500, FONT_DISPLAY);
  ctx.fillStyle = COLOR.text;
  ctx.textAlign = "center";
  ctx.fillText(
    `${HUD_SCORE_LABEL} ${state.score}      ${HUD_LEVEL_LABEL} ${state.level}`,
    STAGE_CX,
    316,
  );

  drawMenu(ctx, "gameover", GAMEOVER_ITEMS, state.menuIndex);

  ctx.font = font(14, 500, FONT_DISPLAY);
  ctx.fillStyle = COLOR.textDim;
  ctx.textAlign = "center";
  ctx.fillText("ESC returns to the title", STAGE_CX, 616);
  ctx.restore();
}
