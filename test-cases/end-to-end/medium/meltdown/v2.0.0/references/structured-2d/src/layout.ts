// Meltdown — where the build panel put each control, and where each menu's rows
// sit.
//
// `specs/hud.md` says what the panel must hold and leaves WHERE entirely to the
// build, which is the rule appearance is held to everywhere else in this game.
// This module is that choice, and it is the single source both the renderer and
// the pointer read: what is drawn and what a tap hits can never disagree,
// because they are the same rectangles. `snapshot().controls` reports them, so
// a scripted scenario operates the panel this build laid out rather than a
// layout the specification would otherwise have to fix.
//
// Every control is at least `MIN_TOUCH_TARGET` on a side and lies inside the
// panel's strip.

import {
  MIN_TOUCH_TARGET,
  PANEL_W,
  PANEL_X,
  TOWER_TYPES,
  type TowerType,
} from "./constants";
import { inRect, type Rect } from "./geometry";
import { menuRows } from "./flow";
import type { MeltdownState, Screen } from "./game";

/** The panel's inner margin. */
export const PANEL_PAD = 12;

/** The left edge and width every panel element is laid out against. */
export const PANEL_INNER_X = PANEL_X + PANEL_PAD;
export const PANEL_INNER_W = PANEL_W - 2 * PANEL_PAD;

/** The status readouts: money, lives, wave, and the build timer under them. */
export const STATUS_Y = 16;
export const STATUS_H = 96;

/** The shop: one row per type, in the shop order of `TOWER_TYPES`. */
export const SHOP_Y = 124;
export const SHOP_ROW_H = 34;
export const SHOP_STEP = 38;

/** The information area: the hover panel, the inspector, or the next wave. */
export const INFO_Y = 434;
export const INFO_H = 146;

/** The three rows of buttons under it. */
export const BUTTON_H = 36;
export const PLACEMENT_Y = 588;
export const SELECTION_Y = 630;
export const WAVE_Y = 672;

/** A shop row, carrying the type it arms. */
export interface ShopRect extends Rect {
  type: TowerType;
}

/** Every control the panel offers, as its hit rectangle. */
export interface PanelControls {
  shop: ShopRect[];
  rotate: Rect | null;
  cancel: Rect | null;
  upgrade: Rect | null;
  sell: Rect | null;
  send: Rect;
  speed: Rect;
  pause: Rect;
  mute: Rect;
}

/** Split a panel row into `count` buttons with a gap between them. */
function row(y: number, count: number, gap = 6): Rect[] {
  const width = (PANEL_INNER_W - gap * (count - 1)) / count;
  const rects: Rect[] = [];
  for (let i = 0; i < count; i += 1) {
    rects.push({
      x: PANEL_INNER_X + i * (width + gap),
      y,
      w: width,
      h: BUTTON_H,
    });
  }
  return rects;
}

/** The eight shop rows, in shop order. */
export function shopRects(): ShopRect[] {
  return TOWER_TYPES.map((type, index) => ({
    type,
    x: PANEL_INNER_X,
    y: SHOP_Y + index * SHOP_STEP,
    w: PANEL_INNER_W,
    h: SHOP_ROW_H,
  }));
}

/**
 * The panel's controls as they stand right now. Rotate and Cancel are drawn
 * only while a preview is held, and Upgrade and Sell only while a tower is
 * selected, so both pairs read `null` otherwise.
 */
export function panelControls(state: MeltdownState): PanelControls {
  const [rotate, cancel] = row(PLACEMENT_Y, 2);
  const [upgrade, sell] = row(SELECTION_Y, 2);
  const [send, speed, pause, mute] = row(WAVE_Y, 4);
  const armed = state.build !== null;
  const selected =
    state.selected !== null &&
    state.towers.some((tower) => tower.id === state.selected);
  return {
    shop: shopRects(),
    rotate: armed ? rotate : null,
    cancel: armed ? cancel : null,
    upgrade: selected ? upgrade : null,
    sell: selected ? sell : null,
    send,
    speed,
    pause,
    mute,
  };
}

/** Which control a press landed on. */
export type PanelHit =
  | { kind: "shop"; type: TowerType }
  | {
      kind:
        | "rotate"
        | "cancel"
        | "upgrade"
        | "sell"
        | "send"
        | "speed"
        | "pause"
        | "mute";
    };

/** The control at a stage position, or `null` for the rest of the panel. */
export function hitPanel(
  state: MeltdownState,
  x: number,
  y: number,
): PanelHit | null {
  const controls = panelControls(state);
  for (const entry of controls.shop) {
    if (inRect(entry, x, y)) return { kind: "shop", type: entry.type };
  }
  const simple = [
    ["rotate", controls.rotate],
    ["cancel", controls.cancel],
    ["upgrade", controls.upgrade],
    ["sell", controls.sell],
    ["send", controls.send],
    ["speed", controls.speed],
    ["pause", controls.pause],
    ["mute", controls.mute],
  ] as const;
  for (const [kind, rect] of simple) {
    if (rect !== null && inRect(rect, x, y)) {
      return { kind } as PanelHit;
    }
  }
  return null;
}

/** Whether every control is at least the minimum touch target on a side. */
export function controlsMeetTouchTarget(state: MeltdownState): boolean {
  const controls = panelControls(state);
  const rects: (Rect | null)[] = [
    ...controls.shop,
    controls.rotate,
    controls.cancel,
    controls.upgrade,
    controls.sell,
    controls.send,
    controls.speed,
    controls.pause,
    controls.mute,
  ];
  return rects.every(
    (rect) =>
      rect === null ||
      (rect.w >= MIN_TOUCH_TARGET && rect.h >= MIN_TOUCH_TARGET),
  );
}

/** Where a screen's menu rows are drawn. */
export interface MenuGeometry {
  x: number;
  y: number;
  w: number;
  rowH: number;
  step: number;
}

/** The geometry of the menu the screen shows; `null` where there is none. */
export function menuGeometry(screen: Screen): MenuGeometry | null {
  switch (screen) {
    case "title":
      return { x: 440, y: 404, w: 400, rowH: 48, step: 58 };
    case "modeselect":
      return { x: 110, y: 200, w: 430, rowH: 48, step: 58 };
    case "difficultyselect":
      return { x: 200, y: 262, w: 520, rowH: 52, step: 64 };
    case "howto":
      // Beside the copy rather than under it, so the block can grow without
      // running into the row that leaves the screen.
      return { x: 830, y: 640, w: 380, rowH: 48, step: 58 };
    case "paused":
      return { x: 440, y: 300, w: 400, rowH: 48, step: 58 };
    case "victory":
    case "gameover":
      return { x: 440, y: 470, w: 400, rowH: 48, step: 58 };
    case "playing":
      return null;
  }
}

/** The rectangle one menu row occupies. */
export function menuRowRect(screen: Screen, index: number): Rect | null {
  const geometry = menuGeometry(screen);
  if (geometry === null) return null;
  return {
    x: geometry.x,
    y: geometry.y + index * geometry.step,
    w: geometry.w,
    h: geometry.rowH,
  };
}

/** The menu row a press landed on, or `null`. */
export function menuRowAt(screen: Screen, x: number, y: number): number | null {
  const rows = menuRows(screen);
  for (let index = 0; index < rows; index += 1) {
    const rect = menuRowRect(screen, index);
    if (rect !== null && inRect(rect, x, y)) return index;
  }
  return null;
}
