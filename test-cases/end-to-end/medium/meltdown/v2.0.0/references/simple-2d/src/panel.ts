// Meltdown — where this build laid the panel out.
//
// specs/hud.md says WHAT the build panel holds and leaves WHERE entirely to the
// build, so the layout is here and nowhere else. The snapshot reports these
// rectangles (specs/instrumentation.md, `controls`) so a scripted scenario taps
// the panel this build drew rather than a layout the specification would
// otherwise have had to fix, and `render.ts` draws from the same numbers, so
// what is reported and what is drawn cannot drift apart.
//
// Every rectangle here is at least `MIN_TOUCH_TARGET` on both sides and lies
// inside the panel strip.

import {
  PANEL_W,
  PANEL_X,
  STAGE_H,
  STAGE_W,
  TOWER_TYPES,
  type TowerType,
} from "./constants";
import { menuLength } from "./flow";
import type { MeltdownState } from "./game";

/** A hit rectangle in logical stage units. */
export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** One shop entry's rectangle, and the type it arms. */
export interface ShopRect extends Rect {
  readonly type: TowerType;
}

/** Every control the panel offers, as its hit rectangle. */
export interface Controls {
  readonly shop: readonly ShopRect[];
  readonly rotate: Rect | null;
  readonly cancel: Rect | null;
  readonly upgrade: Rect | null;
  readonly sell: Rect | null;
  readonly send: Rect;
  readonly speed: Rect;
  readonly pause: Rect;
  readonly mute: Rect;
}

const PAD = 10;

/** The panel's own geometry, shared by the layout and the renderer. */
export const PANEL = {
  x: PANEL_X,
  w: PANEL_W,
  innerX: PANEL_X + PAD,
  innerW: PANEL_W - PAD * 2,
  readoutY: 12,
  readoutH: 84,
  shopY: 104,
  shopRowH: 34,
  shopGap: 4,
  infoY: 412,
  infoH: 174,
  rotateY: 592,
  actionH: 36,
  upgradeY: 636,
  waveY: 680,
  waveH: 32,
} as const;

/** The rectangle of shop entry `index`, whatever the run is doing. */
export function shopRect(index: number): Rect {
  return {
    x: PANEL.innerX,
    y: PANEL.shopY + index * (PANEL.shopRowH + PANEL.shopGap),
    w: PANEL.innerW,
    h: PANEL.shopRowH,
  };
}

function halfRow(y: number, right: boolean): Rect {
  const w = (PANEL.innerW - 6) / 2;
  return {
    x: right ? PANEL.innerX + w + 6 : PANEL.innerX,
    y,
    w,
    h: PANEL.actionH,
  };
}

function quarterRow(index: number): Rect {
  const w = (PANEL.innerW - 18) / 4;
  return {
    x: PANEL.innerX + index * (w + 6),
    y: PANEL.waveY,
    w,
    h: PANEL.waveH,
  };
}

/** The selected tower, when the selection still names one on the floor. */
export function selectedTower(state: MeltdownState) {
  if (state.selected === null) return null;
  return state.towers.find((tower) => tower.id === state.selected) ?? null;
}

/**
 * Every control the panel offers right now. The two placement controls are
 * drawn only while a preview is held and the two tower actions only while a
 * tower is selected, so each is `null` the rest of the time.
 */
export function controlsOf(state: MeltdownState): Controls {
  const armed = state.build !== null;
  const selected = selectedTower(state) !== null;
  return {
    shop: TOWER_TYPES.map((type, index) => ({ ...shopRect(index), type })),
    rotate: armed ? halfRow(PANEL.rotateY, false) : null,
    cancel: armed ? halfRow(PANEL.rotateY, true) : null,
    upgrade: selected ? halfRow(PANEL.upgradeY, false) : null,
    sell: selected ? halfRow(PANEL.upgradeY, true) : null,
    send: quarterRow(0),
    speed: quarterRow(1),
    pause: quarterRow(2),
    mute: quarterRow(3),
  };
}

/** Whether `(x, y)` lies inside `rect`. */
export function hit(rect: Rect | null, x: number, y: number): boolean {
  if (!rect) return false;
  return (
    x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h
  );
}

/** Whether `(x, y)` lies in the build panel's strip. */
export function inPanel(x: number): boolean {
  return x >= PANEL.x;
}

const MENU_W = 420;
const MENU_ROW_H = 44;
const MENU_GAP = 8;

/** Where a screen's menu block starts, in logical stage units. */
function menuTop(state: MeltdownState): number {
  switch (state.screen) {
    case "title":
      return 400;
    case "modeselect":
      return 236;
    case "difficultyselect":
      return 300;
    case "howto":
      return 650;
    case "paused":
      return 296;
    case "victory":
    case "gameover":
      return 470;
    default:
      return STAGE_H;
  }
}

/** The rectangle of each row of the current screen's menu, top to bottom. */
export function menuRects(state: MeltdownState): Rect[] {
  const count = menuLength(state.screen);
  const top = menuTop(state);
  const rects: Rect[] = [];
  for (let i = 0; i < count; i += 1) {
    rects.push({
      x: (STAGE_W - MENU_W) / 2,
      y: top + i * (MENU_ROW_H + MENU_GAP),
      w: MENU_W,
      h: MENU_ROW_H,
    });
  }
  return rects;
}

/** The menu row `(x, y)` falls on, or `null`. */
export function menuRowAt(
  state: MeltdownState,
  x: number,
  y: number,
): number | null {
  const rects = menuRects(state);
  for (let i = 0; i < rects.length; i += 1) {
    if (hit(rects[i], x, y)) return i;
  }
  return null;
}
