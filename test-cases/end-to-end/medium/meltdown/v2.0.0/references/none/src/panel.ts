// Meltdown — the build panel's layout, and the rectangles it reports.
//
// `specs/hud.md` says what the panel must hold and leaves WHERE entirely to the
// build, so every figure here is this build's own. What makes that workable from
// outside is that the panel reports where it put each control, and the debug
// snapshot carries those rectangles: a scripted scenario taps the centre of the
// rectangle the panel actually drew rather than a layout a specification would
// otherwise have had to fix (specs/instrumentation.md).
//
// Every control is at least MIN_TOUCH_TARGET on both sides and lies inside the
// panel's strip, which `panel.test.ts` checks rather than trusting the numbers
// below to stay that way.

import { MIN_TOUCH_TARGET, PANEL_W, PANEL_X, TOWER_TYPES } from "./constants";
import type { MeltdownState } from "./state";
import type { Rect, TowerType } from "./types";

/** The panel's own metrics, in logical stage units. */
export const PANEL = {
  pad: 10,
  columnGap: 8,
  rowGap: 8,
  statusY: 12,
  statusH: 92,
  shopLabelY: 112,
  shopY: 128,
  shopCellH: 40,
  placeY: 320,
  placeH: 36,
  infoY: 364,
  // The information area stops a row gap short of the action row. It used to run
  // 240 units deep, which put its last rows UNDER the Upgrade and Sell buttons —
  // the inspector's bottom two fields were drawn and then painted over, so a
  // player reading a selected tower's kills and damage read the button instead.
  // `panel.test.ts` now holds every one of these rectangles apart.
  infoH: 184,
  actionY: 556,
  actionH: 40,
  sendY: 616,
  sendH: 40,
  toggleY: 664,
  toggleH: 40,
} as const;

/** The panel's inner column: everything is laid out inside this. */
export const INNER_X = PANEL_X + PANEL.pad;
export const INNER_W = PANEL_W - 2 * PANEL.pad;
/** Two equal columns, which is what the shop and the paired buttons use. */
export const COL_W = (INNER_W - PANEL.columnGap) / 2;
export const COL2_X = INNER_X + COL_W + PANEL.columnGap;
/** Three equal buttons, which is what the speed, pause and mute row uses. */
export const TOGGLE_W = (INNER_W - 2 * PANEL.columnGap) / 3;

/** One shop entry's rectangle, tagged with the type it arms. */
export interface ShopRect extends Rect {
  type: TowerType;
}

/** Every control the panel offers, as the rectangle it was drawn on. */
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

/** The shop's eight entries, two to a row, in the shop order of `TOWER_TYPES`. */
export function shopRects(): ShopRect[] {
  return TOWER_TYPES.map((type, index) => ({
    type,
    x: index % 2 === 0 ? INNER_X : COL2_X,
    y: PANEL.shopY + Math.floor(index / 2) * (PANEL.shopCellH + PANEL.rowGap),
    w: COL_W,
    h: PANEL.shopCellH,
  }));
}

/** The area the hover panel, the inspector and the next-wave preview share. */
export const INFO_RECT: Rect = {
  x: INNER_X,
  y: PANEL.infoY,
  w: INNER_W,
  h: PANEL.infoH,
};

/** The status readouts' area. */
export const STATUS_RECT: Rect = {
  x: INNER_X,
  y: PANEL.statusY,
  w: INNER_W,
  h: PANEL.statusH,
};

const ROTATE_RECT: Rect = {
  x: INNER_X,
  y: PANEL.placeY,
  w: COL_W,
  h: PANEL.placeH,
};
const CANCEL_RECT: Rect = {
  x: COL2_X,
  y: PANEL.placeY,
  w: COL_W,
  h: PANEL.placeH,
};
const UPGRADE_RECT: Rect = {
  x: INNER_X,
  y: PANEL.actionY,
  w: COL_W,
  h: PANEL.actionH,
};
const SELL_RECT: Rect = {
  x: COL2_X,
  y: PANEL.actionY,
  w: COL_W,
  h: PANEL.actionH,
};
const SEND_RECT: Rect = {
  x: INNER_X,
  y: PANEL.sendY,
  w: INNER_W,
  h: PANEL.sendH,
};
const SPEED_RECT: Rect = {
  x: INNER_X,
  y: PANEL.toggleY,
  w: TOGGLE_W,
  h: PANEL.toggleH,
};
const PAUSE_RECT: Rect = {
  x: INNER_X + TOGGLE_W + PANEL.columnGap,
  y: PANEL.toggleY,
  w: TOGGLE_W,
  h: PANEL.toggleH,
};
const MUTE_RECT: Rect = {
  x: INNER_X + 2 * (TOGGLE_W + PANEL.columnGap),
  y: PANEL.toggleY,
  w: TOGGLE_W,
  h: PANEL.toggleH,
};

/**
 * Where the panel put each control for the state it is drawing.
 *
 * Rotate and Cancel are drawn only while a placement is armed, and Upgrade and
 * Sell only while a tower is selected, so each reads `null` when the panel is
 * not drawing it (specs/hud.md).
 */
export function panelControls(state: MeltdownState): PanelControls {
  const armed = state.build !== null;
  const selected = state.selected !== null;
  return {
    shop: shopRects(),
    rotate: armed ? { ...ROTATE_RECT } : null,
    cancel: armed ? { ...CANCEL_RECT } : null,
    upgrade: selected ? { ...UPGRADE_RECT } : null,
    sell: selected ? { ...SELL_RECT } : null,
    send: { ...SEND_RECT },
    speed: { ...SPEED_RECT },
    pause: { ...PAUSE_RECT },
    mute: { ...MUTE_RECT },
  };
}

/** Every rectangle the panel can draw, whether or not it is drawing it now. */
export function everyControlRect(): Rect[] {
  return [
    ...shopRects(),
    ROTATE_RECT,
    CANCEL_RECT,
    UPGRADE_RECT,
    SELL_RECT,
    SEND_RECT,
    SPEED_RECT,
    PAUSE_RECT,
    MUTE_RECT,
  ];
}

/** Whether a rectangle meets the panel's own floor for a touch target. */
export function isTouchTarget(rect: Rect): boolean {
  return rect.w >= MIN_TOUCH_TARGET && rect.h >= MIN_TOUCH_TARGET;
}
