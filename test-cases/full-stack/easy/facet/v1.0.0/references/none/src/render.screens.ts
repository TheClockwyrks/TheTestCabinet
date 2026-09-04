// Facet — the screens around the board: the title, how to play, the pause menu,
// the end of a level, and the end of a round.
//
// All five are chrome and all five are drawn in code (specs/assets.md). Every
// piece of copy on them is a constant `specs/ui.md` fixes, and the highlighted
// menu item is drawn distinctly from the others so a player always sees which
// item `confirm`, or a release, would take.
//
// EVERY MENU IS DRAWN ON ITS TARGETS. `specs/controls.md` requires a `menu-<i>`
// target to cover the drawn item it highlights, and `src/core/targets.ts` is
// where those rectangles come from, so `drawMenu` asks the core for the screen's
// targets and fills each one rather than laying the rows out a second time. Two
// independent sets of numbers would agree only until one of them was edited,
// and a player pressing an item that turns out not to be there is exactly the
// failure that would follow. The `back` control on `howto` is drawn the same
// way, on the rectangle the core reports for it.
//
// `paused`, `levelclear`, and `gameover` draw the board first and lay a scrim
// over it, because `specs/ui.md` asks for the position to be readable behind
// all three.

import {
  BEST_CHAIN_LABEL,
  BEST_MOVE_LABEL,
  BACK_LABEL,
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
import { drawGem } from "./render.gems";
import {
  COLOR,
  FONT_BODY,
  FONT_DISPLAY,
  FONT_NUMERIC,
  drawControl,
  drawTracked,
  font,
  roundedRect,
} from "./theme";
import { targetsFor } from "./core";
import type { AssetStore } from "./assets";
import type { FacetState, Gem, Screen } from "./core";

/**
 * How to play, in a player's words rather than as rules of a system, in the two
 * columns the panel is laid out in. Between them the two columns cover every
 * point `specs/ui.md` asks the screen to make.
 */
const HOWTO_LEFT: readonly string[] = [
  "The bench holds an eight-by-eight field of cut",
  "stones in seven kinds. Press a stone to take hold",
  "of it, carry it onto the stone beside it, and let",
  "go. Carry it back where it started and you have",
  "let go of nothing: a move is played only by",
  "letting go with the stone offered onto a neighbor.",
  "",
  "Three or more of one kind in a line shatter, and a",
  "move that shatters nothing is refused and leaves",
  "the board exactly as it was. Every stone beside a",
  "shattering line takes strain, and a stone that has",
  "taken enough of it is flawed: it shatters along",
  "with any clear it touches, and it is worth double.",
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
  "is over and the next one opens. The round ends",
  "when no move is left that would shatter anything.",
  "",
];

/** The controls block under the how-to copy, naming the fixed bindings. */
const HOWTO_CONTROLS: readonly string[] = [
  "The board is played with a mouse, a pen, or a finger: press a stone, carry it onto its neighbor, let go.",
  "The menus answer that same pointer, and the keys: ARROW UP and ARROW DOWN choose, ENTER or SPACE accepts,",
  "ESC or P pauses, ESC goes back, M turns the sound on and off, and the backtick key shows the debug overlay.",
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

/** The scrim the three in-round screens lay over the board behind them. */
export function drawScrim(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = COLOR.scrim;
  ctx.fillRect(0, 0, STAGE_W, STAGE_H);
}

/**
 * The screen's vertical menu, one item drawn to fill each `menu-<i>` target the
 * core reports for that screen, with the item at `menuIndex` highlighted.
 *
 * The targets and the items are the same list in the same order — one target
 * per entry of the screen's menu constant — so the two are walked together and
 * the drawn row is the rectangle a press lands in, exactly.
 */
export function drawMenu(
  ctx: CanvasRenderingContext2D,
  screen: Screen,
  items: readonly string[],
  menuIndex: number,
): void {
  const targets = targetsFor(screen);
  items.forEach((item, index) => {
    const target = targets[index];
    if (target === undefined) return;
    drawControl(ctx, target, item, index === menuIndex, 28, 6);
  });
}

/**
 * A dim label over a figure, which is how both of the level's measurements and
 * the round's final score are reported.
 */
function drawStat(
  ctx: CanvasRenderingContext2D,
  label: string,
  value: string,
  x: number,
  y: number,
): void {
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.font = font(15, 600, FONT_DISPLAY);
  ctx.fillStyle = COLOR.textDim;
  drawTracked(ctx, label, x, y, 3);
  ctx.font = font(40, 700, FONT_NUMERIC);
  ctx.fillStyle = COLOR.text;
  ctx.fillText(value, x, y + 46);
}

/**
 * The row of stones under the title: one of each kind and the turning prism,
 * bobbing on game time so the title screen is alive and shows the art the board
 * is played with.
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
    const bob = Math.sin(state.simTime * 1.6 + index * 0.7) * 7;
    drawGem(ctx, assets, gem, first + index * pitch, 322 + bob, state.simTime);
  });
}

/** The title screen: the title, the tagline, the stones, and the menu. */
export function drawTitleScreen(
  ctx: CanvasRenderingContext2D,
  assets: AssetStore,
  state: FacetState,
): void {
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";

  ctx.font = font(100, 700, FONT_DISPLAY);
  ctx.fillStyle = COLOR.gold;
  drawTracked(ctx, TITLE_TEXT, STAGE_CX, 168, 26);

  ctx.font = font(22, 500, FONT_DISPLAY);
  ctx.fillStyle = COLOR.textDim;
  drawTracked(ctx, TAGLINE_TEXT, STAGE_CX, 214, 8);

  ctx.strokeStyle = COLOR.goldDim;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(STAGE_CX - 300, 244);
  ctx.lineTo(STAGE_CX + 300, 244);
  ctx.stroke();

  drawTitleStones(ctx, assets, state);

  drawMenu(ctx, "title", TITLE_ITEMS, state.menuIndex);

  ctx.font = font(14, 500, FONT_DISPLAY);
  ctx.fillStyle = COLOR.textDim;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(
    "PRESS AN ITEM, OR ARROWS AND ENTER      M FOR SOUND",
    STAGE_CX,
    664,
  );
  ctx.restore();
}

/**
 * How to play, written for a player. The `back` control carries the pointer
 * target `specs/controls.md` names, so a player with only a touchscreen leaves
 * the screen the same way the `back` key does.
 */
export function drawHowToScreen(ctx: CanvasRenderingContext2D): void {
  ctx.save();
  ctx.textBaseline = "alphabetic";
  drawPanel(ctx, 92, 40, STAGE_W - 184, 664);

  ctx.font = font(38, 700, FONT_DISPLAY);
  ctx.fillStyle = COLOR.gold;
  ctx.textAlign = "center";
  drawTracked(ctx, "HOW TO PLAY", STAGE_CX, 104, 10);

  ctx.strokeStyle = COLOR.goldDim;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(140, 130);
  ctx.lineTo(STAGE_W - 140, 130);
  ctx.stroke();

  ctx.font = font(16, 400, FONT_BODY);
  ctx.fillStyle = COLOR.text;
  ctx.textAlign = "left";
  HOWTO_LEFT.forEach((line, index) => {
    ctx.fillText(line, 140, 172 + index * 25);
  });
  HOWTO_RIGHT.forEach((line, index) => {
    ctx.fillText(line, 672, 172 + index * 25);
  });

  ctx.beginPath();
  ctx.moveTo(140, 502);
  ctx.lineTo(STAGE_W - 140, 502);
  ctx.stroke();

  ctx.font = font(14, 500, FONT_DISPLAY);
  ctx.fillStyle = COLOR.textDim;
  ctx.textAlign = "center";
  HOWTO_CONTROLS.forEach((line, index) => {
    ctx.fillText(line, STAGE_CX, 536 + index * 22);
  });

  const [back] = targetsFor("howto");
  drawControl(ctx, back, BACK_LABEL, true);
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
  drawPanel(ctx, STAGE_CX - 280, 220, 560, 360);

  ctx.font = font(50, 700, FONT_DISPLAY);
  ctx.fillStyle = COLOR.gold;
  ctx.textAlign = "center";
  drawTracked(ctx, PAUSED_TITLE_TEXT, STAGE_CX, 296, 14);

  drawMenu(ctx, "paused", PAUSED_ITEMS, state.menuIndex);

  ctx.font = font(14, 500, FONT_DISPLAY);
  ctx.fillStyle = COLOR.textDim;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillText("ESC or P returns to the board", STAGE_CX, 558);
  ctx.restore();
}

/**
 * The end of a level: the level just finished and the two figures it was
 * measured by, over the board the chain left standing.
 */
export function drawLevelClearScreen(
  ctx: CanvasRenderingContext2D,
  state: FacetState,
): void {
  ctx.save();
  ctx.textBaseline = "alphabetic";
  drawScrim(ctx);
  drawPanel(ctx, STAGE_CX - 320, 168, 640, 468);

  ctx.font = font(46, 700, FONT_DISPLAY);
  ctx.fillStyle = COLOR.gold;
  ctx.textAlign = "center";
  drawTracked(ctx, LEVELCLEAR_TITLE_TEXT, STAGE_CX, 240, 10);

  ctx.font = font(22, 500, FONT_DISPLAY);
  ctx.fillStyle = COLOR.text;
  ctx.textAlign = "center";
  drawTracked(ctx, `${HUD_LEVEL_LABEL} ${state.level}`, STAGE_CX, 282, 6);

  drawStat(ctx, BEST_CHAIN_LABEL, String(state.bestChain), STAGE_CX - 148, 336);
  drawStat(ctx, BEST_MOVE_LABEL, String(state.bestMove), STAGE_CX + 148, 336);

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
  drawPanel(ctx, STAGE_CX - 320, 168, 640, 430);

  ctx.font = font(44, 700, FONT_DISPLAY);
  ctx.fillStyle = COLOR.gold;
  ctx.textAlign = "center";
  drawTracked(ctx, GAMEOVER_TITLE_TEXT, STAGE_CX, 238, 10);

  drawStat(ctx, HUD_SCORE_LABEL, String(state.score), STAGE_CX - 148, 296);
  drawStat(ctx, HUD_LEVEL_LABEL, String(state.level), STAGE_CX + 148, 296);

  drawMenu(ctx, "gameover", GAMEOVER_ITEMS, state.menuIndex);
  ctx.restore();
}
