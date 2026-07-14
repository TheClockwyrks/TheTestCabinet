// Holdfast — the menu / overlay state screens (DESIGN §5, specs/flow.md "Required menus").
//
// The full-stage screens render.ts hands off to: the title + main menu (NEW COLONY / HOW TO
// PLAY), the how-to-play page, the Esc pause overlay (Resume / Restart / Quit to menu), and
// the colony-lost screen (days survived + the secondary tally, Restart / Menu). Each draws
// its menu from menus.ts so the keyboard cursor and the pointer hit-tests agree, and pushes
// the frame's Clickable[] for the input layer. There is no win screen — Holdfast is pure
// survival, so the only end state is the colony-lost screen.

import { COL, STAGE_H, STAGE_W } from "./constants";
import type { Clickable } from "./types";
import type { Game } from "./sim";
import { menuItems, type MenuItem } from "./menus";
import { button, hexA, inRect, lineCount, menuIndexNow, ptr, roundRect, text, wrap } from "./render";

const TAGLINE = "A FRONTIER COLONY AGAINST THE DARK — HOW LONG CAN YOU HOLD?";

// ---- title / main menu --------------------------------------------------------
export function drawTitle(ctx: CanvasRenderingContext2D, game: Game, clicks: Clickable[]): void {
  ctx.fillStyle = COL.void;
  ctx.fillRect(0, 0, STAGE_W, STAGE_H);

  // A faint ground grid for depth (drawn in code — pure chrome).
  ctx.save();
  ctx.strokeStyle = hexA(COL.text, 0.04);
  ctx.lineWidth = 1;
  for (let x = 0; x <= STAGE_W; x += 48) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, STAGE_H);
    ctx.stroke();
  }
  for (let y = 0; y <= STAGE_H; y += 48) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(STAGE_W, y);
    ctx.stroke();
  }
  ctx.restore();

  ctx.save();
  ctx.shadowColor = hexA(COL.wood, 0.7);
  ctx.shadowBlur = 26;
  text(ctx, "HOLDFAST", STAGE_W / 2, 240, 88, COL.wood, "center", "800", 16);
  ctx.restore();
  text(ctx, TAGLINE, STAGE_W / 2, 316, 15, COL.text2, "center", "500", 5);

  const items = menuItems("title", game);
  items.forEach((it, i) => {
    const y = 420 + i * 60;
    const on = highlighted(i, STAGE_W / 2 - 200, y - 26, 400, 52);
    text(ctx, it.label, STAGE_W / 2, y, 30, on ? COL.food : COL.text, "center", "700", 6);
    if (on) {
      text(ctx, "▶", STAGE_W / 2 - 190, y, 20, COL.food, "center", "700");
      text(ctx, "◀", STAGE_W / 2 + 190, y, 20, COL.food, "center", "700");
    }
    clicks.push({ x: STAGE_W / 2 - 200, y: y - 26, w: 400, h: 52, action: it.action });
  });
  text(ctx, "↑↓ SELECT    ENTER CONFIRM    MOUSE OK", STAGE_W / 2, 660, 13, COL.text3, "center", "500", 4);
}

// ---- how to play --------------------------------------------------------------
export function drawHowto(ctx: CanvasRenderingContext2D, clicks: Clickable[]): void {
  ctx.fillStyle = COL.void;
  ctx.fillRect(0, 0, STAGE_W, STAGE_H);
  text(ctx, "HOW TO PLAY", STAGE_W / 2, 58, 32, COL.text, "center", "700", 4);

  const lines: [string, string][] = [
    ["GOAL", "Keep your settlers alive. There is no win — the colony endures until the last settler dies, and the score is the days it survived. Every raid grows and the larder empties, so build a defense and a food chain faster than the dark closes in."],
    ["SETTLERS", "You never control a settler directly. You DESIGNATE work and PLACE builds; settlers pull the highest-priority job they can reach and carry it out while their hunger, rest, and mood drift. The three starters have distinct standout skills — they are not interchangeable."],
    ["GATHER & HAUL", "Designate a tree stand or ore vein to chop/mine — the single designate tool reads the node under it. Cleared nodes drop a pile; a settler hauls it to the central stockpile before it counts as stock."],
    ["BUILD", "Pick a structure and place it; the cost is deducted at placement, and cancelling a blueprint refunds it in full. Walls block and give cover, doors close a wall line, a stove cooks crops into meals, farms grow crops in daylight (best on grass), and turrets defend automatically."],
    ["DEFENSE", "Raiders shoot from the open and take cover, but they do NOT break your walls — a fire-covered wall line with a door and a turret holds them off. A downed settler bleeds out unless an ally tends them in time."],
    ["DAY / NIGHT", "The clock turns; settlers work by day and sleep by preference at night, and rest drains faster after dark. Raids favor the night — post the guard before dusk."],
    ["CONTROLS", "Click a roster card to select a settler; open the WORK GRID to set each settler's job priorities. 1/2/3 set speed, SPACE pauses in place (the board stays interactive), ESC opens the pause menu, M mutes. Drag the designate tool over an area to mark it."],
  ];
  let y = 104;
  for (const [k, v] of lines) {
    text(ctx, k, 150, y, 13, COL.food, "left", "700", 1);
    wrap(ctx, v, 330, y, 800, 13, COL.text2, 19);
    y += lineCount(ctx, v, 800, 13) * 19 + 12;
  }
  button(ctx, clicks, STAGE_W / 2 - 90, STAGE_H - 62, 180, 42, "BACK", "menu:back", COL.text, true);
}

// ---- pause overlay ------------------------------------------------------------
export function drawPause(ctx: CanvasRenderingContext2D, game: Game, clicks: Clickable[]): void {
  dim(ctx);
  panelBox(ctx, STAGE_W / 2 - 200, 210, 400, 300);
  text(ctx, "PAUSED", STAGE_W / 2, 262, 30, COL.text, "center", "700", 4);
  menuButtons(ctx, menuItems("paused", game), 328, 56, 260, clicks);
}

// ---- colony-lost screen -------------------------------------------------------
export function drawGameOver(ctx: CanvasRenderingContext2D, game: Game, clicks: Clickable[]): void {
  dim(ctx);
  panelBox(ctx, STAGE_W / 2 - 240, 168, 480, 384);
  text(ctx, "COLONY LOST", STAGE_W / 2, 214, 15, COL.alert, "center", "700", 3);
  text(ctx, game.score.days.toFixed(1), STAGE_W / 2, 270, 56, COL.wood, "center", "800", 2);
  text(ctx, "DAYS SURVIVED", STAGE_W / 2, 312, 14, COL.text2, "center", "600", 3);

  const tally: [string, string][] = [
    ["RAIDS REPELLED", `${game.score.raidsRepelled}`],
    ["RAIDERS KILLED", `${game.score.raidersKilled}`],
    ["STRUCTURES BUILT", `${game.score.structuresBuilt}`],
    ["PEAK POPULATION", `${game.score.peakPop}`],
  ];
  let ty = 350;
  const lx = STAGE_W / 2 - 180;
  const rx = STAGE_W / 2 + 180;
  for (const [k, v] of tally) {
    text(ctx, k, lx, ty, 12, COL.text3, "left", "600", 1);
    text(ctx, v, rx, ty, 13, COL.text, "right", "700");
    ty += 26;
  }

  const items = menuItems("gameover", game);
  const xs = [STAGE_W / 2 - 170, STAGE_W / 2 + 10];
  items.forEach((it, i) => {
    const on = highlighted(i, xs[i]!, 486, 160, 46);
    button(ctx, clicks, xs[i]!, 486, 160, 46, it.label, it.action, on ? COL.food : COL.text, true);
  });
}

// ---- shared ------------------------------------------------------------------
function menuButtons(ctx: CanvasRenderingContext2D, items: MenuItem[], y0: number, gap: number, w: number, clicks: Clickable[]): void {
  const x = STAGE_W / 2 - w / 2;
  items.forEach((it, i) => {
    const y = y0 + i * gap;
    const on = highlighted(i, x, y, w, 44);
    button(ctx, clicks, x, y, w, 44, it.label, it.action, on ? COL.food : COL.text, true);
  });
}

function highlighted(i: number, x: number, y: number, w: number, h: number): boolean {
  const p = ptr();
  return menuIndexNow() === i || inRect(p.x, p.y, x, y, w, h);
}

function dim(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = "rgba(6,9,14,0.72)";
  ctx.fillRect(0, 0, STAGE_W, STAGE_H);
}

function panelBox(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.5)";
  ctx.shadowBlur = 30;
  roundRect(ctx, x, y, w, h, 14);
  ctx.fillStyle = COL.panel;
  ctx.fill();
  ctx.restore();
  roundRect(ctx, x, y, w, h, 14);
  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  ctx.lineWidth = 1;
  ctx.stroke();
}
