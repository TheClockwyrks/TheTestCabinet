// Deepcore — where every clickable control sits, as a function of the state
// (specs/ui.md, specs/controls.md).
//
// Every menu item, panel control, status-bar control, and surface building is
// clickable, and each is also reachable from the keyboard. Both halves need the
// same rectangles: the player controller hit-tests a click against them, and the
// HUD layer draws them. A drawing that pushed its rectangles out as it drew would
// make the pointer depend on the previous frame's picture — and the controller
// ticks before anything draws — so the layout is computed here, from the state
// alone, and the drawing renders what this module lists.
//
// A control carries everything the drawing needs for its button: where it is,
// what it reads, whether it is refused, and the accent it takes. What the drawing
// adds around them is decoration.

import {
  FUEL_BUY_INCREMENT,
  FUEL_PRICE,
  HUD_H,
  ITEMS,
  MINERALS,
  REPAIR_BUY_INCREMENT,
  REPAIR_PRICE,
  STAGE_H,
  STAGE_W,
  SURFACE_Y,
  TILE,
  TRACKS,
} from "./constants";
import type { PanelId } from "./constants";
import {
  fuelCost,
  fuelDeficit,
  hullDeficit,
  nextUpgradePrice,
  repairCost,
} from "./economy";
import { atSurface, cargoValue } from "./figures";
import type { DeepcoreState } from "./game";
import { menuItems } from "./menus";
import { allInstalled, canFabricate, nextComponent } from "./rocket";
import { PALETTE } from "./theme";
import { BUILDING_H, BUILDING_W, buildingPlace, CAMP_ORDER } from "./tuning";
import { tileLeft } from "./world";

/** One clickable control: where it is, what it reads, and what choosing it runs. */
export interface Control {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  /** The action `activate` in `src/flow.ts` runs, or the engine's mute toggle. */
  readonly action: string;
  /** What the button reads. A building's hit area carries none. */
  readonly label: string | null;
  readonly disabled: boolean;
  /** True for the highlighted menu item and for an open panel's own control. */
  readonly selected: boolean;
  /** The color the button takes when it is hot. */
  readonly accent: string;
}

/** A panel's frame, which the drawing renders and the controls sit inside. */
export interface PanelFrame {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly title: string;
}

/** The size and title of each panel's frame. */
const PANEL_FRAMES: Readonly<
  Record<
    PanelId,
    { readonly title: string; readonly w: number; readonly h: number }
  >
> = {
  "fuel-depot": { title: "FUEL DEPOT", w: 760, h: 480 },
  "ore-market": { title: "ORE MARKET", w: 760, h: 600 },
  "upgrade-shop": { title: "UPGRADE SHOP", w: 760, h: 560 },
  "supply-depot": { title: "SUPPLY DEPOT", w: 760, h: 520 },
  "launch-pad": { title: "LAUNCH PAD", w: 760, h: 480 },
  inventory: { title: "CARGO HOLD", w: 980, h: 600 },
};

/** Where a panel's frame sits on the stage. */
export function panelFrame(panel: PanelId): PanelFrame {
  const spec = PANEL_FRAMES[panel];
  return {
    x: STAGE_W / 2 - spec.w / 2,
    y: STAGE_H / 2 - spec.h / 2 + 20,
    w: spec.w,
    h: spec.h,
    title: spec.title,
  };
}

/** The menu column's geometry, shared by the pointer and the drawing. */
export const MENU_COLUMN = { w: 320, h: 52, gap: 64 } as const;

/** The row a screen's menu column starts at. */
const MENU_TOP: Readonly<Record<string, number>> = {
  title: 340,
  "mode-select": 360,
  "size-select": 350,
  "how-to-play": 588,
  paused: 300,
  victory: 500,
  "game-over": 500,
};

/**
 * The hazard notice card, which is one clickable that dismisses it. It is
 * anchored low in the viewport, clear of the miner near the vertical center, so
 * it explains the hull drop without covering where the blow landed.
 */
export const NOTICE_CARD = {
  w: 640,
  h: 172,
  x: STAGE_W / 2 - 320,
  y: STAGE_H - 172 - 36,
} as const;

function control(
  x: number,
  y: number,
  w: number,
  h: number,
  action: string,
  label: string | null,
  options: {
    disabled?: boolean;
    selected?: boolean;
    accent?: string;
  } = {},
): Control {
  return {
    x,
    y,
    w,
    h,
    action,
    label,
    disabled: options.disabled ?? false,
    selected: options.selected ?? false,
    accent: options.accent ?? PALETTE.hull,
  };
}

/** Every control the state currently offers, in the order they are drawn. */
export function controlsFor(state: DeepcoreState): readonly Control[] {
  const controls: Control[] = [];
  if (state.screen === "in-mine" || state.screen === "paused") {
    if (state.screen === "in-mine" && !state.panel) {
      controls.push(...buildingControls(state));
    }
    controls.push(...statusBarControls(state));
    if (state.screen === "in-mine" && state.panel) {
      controls.push(...panelControls(state, state.panel));
    }
    if (state.screen === "paused") controls.push(...menuControls(state));
    if (state.screen === "in-mine" && state.notice?.shown) {
      controls.push(
        control(
          NOTICE_CARD.x,
          NOTICE_CARD.y,
          NOTICE_CARD.w,
          NOTICE_CARD.h,
          "notice:dismiss",
          null,
        ),
      );
    }
    return controls;
  }
  controls.push(...menuControls(state));
  return controls;
}

/** The status bar's three controls, on the right of the bar. */
function statusBarControls(state: DeepcoreState): Control[] {
  return [
    control(STAGE_W - 222, 12, 64, 32, "sys:inventory", "BAG", {
      selected: state.panel === "inventory",
    }),
    control(STAGE_W - 150, 12, 64, 32, "sys:pause", "PAUSE"),
    control(
      STAGE_W - 78,
      12,
      64,
      32,
      "sys:mute",
      state.muted ? "UNMUTE" : "MUTE",
    ),
  ];
}

/**
 * The six buildings' hit areas, which stand where the camera puts them. Clicking
 * one activates it exactly as `activate` does while standing at it, so the Save
 * Pad banks the expedition and every other building opens its panel.
 */
function buildingControls(state: DeepcoreState): Control[] {
  if (!atSurface(state.miner)) return [];
  const offX = -state.camX;
  const groundY = SURFACE_Y + HUD_H - state.camY;
  return CAMP_ORDER.map((id) => {
    const place = buildingPlace(id);
    const cx = tileLeft(place.col) + TILE / 2 + offX;
    return control(
      cx - BUILDING_W / 2,
      Math.max(HUD_H, groundY - BUILDING_H - 6),
      BUILDING_W,
      BUILDING_H + 6,
      id === "save-pad" ? "save" : `open:${id}`,
      null,
    );
  });
}

/** The current screen's menu, as a column of buttons. */
function menuControls(state: DeepcoreState): Control[] {
  const items = menuItems(state);
  const top = MENU_TOP[state.screen] ?? 340;
  const x = STAGE_W / 2 - MENU_COLUMN.w / 2;
  return items.map((item, index) =>
    control(
      x,
      top + index * MENU_COLUMN.gap,
      MENU_COLUMN.w,
      MENU_COLUMN.h,
      item.action,
      item.label,
      { selected: state.menuIndex === index, accent: PALETTE.credits },
    ),
  );
}

/** The CLOSE control every panel carries, in its bottom-right corner. */
function closeControl(frame: PanelFrame): Control {
  return control(
    frame.x + frame.w - 130,
    frame.y + frame.h - 56,
    110,
    40,
    "panel:close",
    "CLOSE",
  );
}

/** Where the Fuel Depot's two rows sit inside its frame. */
export const DEPOT_ROWS = { fuel: 150, hull: 240 } as const;

/** Where the Upgrade Shop's first row sits, and how far apart the rows are. */
export const SHOP_ROWS = { top: 84, gap: 58 } as const;

/** Where the Supply Depot's first row sits, and how far apart the rows are. */
export const SUPPLY_ROWS = { top: 112, gap: 58 } as const;

/** Where the inventory's two columns and their rows sit. */
export const INVENTORY = {
  oreTop: 122,
  oreGap: 32,
  supplyTop: 134,
  supplyGap: 40,
  rightOffset: 500,
  rightWidth: 452,
} as const;

/** The controls the open panel carries. */
function panelControls(state: DeepcoreState, panel: PanelId): Control[] {
  const frame = panelFrame(panel);
  const controls: Control[] = [];
  switch (panel) {
    case "fuel-depot": {
      const missingFuel = fuelDeficit(state.miner.fuel, state.tiers);
      const fuelFull = missingFuel <= 0;
      const noFuelMoney = fuelFull || state.credits < FUEL_PRICE;
      const fuelY = frame.y + DEPOT_ROWS.fuel;
      controls.push(
        control(
          frame.x + 352,
          fuelY - 12,
          78,
          38,
          "buyfuel:increment",
          `+${FUEL_BUY_INCREMENT}`,
          { disabled: noFuelMoney, accent: PALETTE.fuel },
        ),
        control(
          frame.x + 442,
          fuelY - 12,
          200,
          38,
          "buyfuel:full",
          fuelFull ? "FULL" : `FILL ${fuelCost(missingFuel)} Cr`,
          { disabled: noFuelMoney, accent: PALETTE.fuel },
        ),
      );
      const missingHull = hullDeficit(state.miner.hull, state.tiers);
      const hullFull = missingHull <= 0;
      const noHullMoney = hullFull || state.credits < REPAIR_PRICE;
      const hullY = frame.y + DEPOT_ROWS.hull;
      controls.push(
        control(
          frame.x + 352,
          hullY - 12,
          78,
          38,
          "buyrepair:increment",
          `+${REPAIR_BUY_INCREMENT}`,
          { disabled: noHullMoney, accent: PALETTE.hull },
        ),
        control(
          frame.x + 442,
          hullY - 12,
          200,
          38,
          "buyrepair:full",
          hullFull ? "FULL" : `REPAIR ${repairCost(missingHull)} Cr`,
          { disabled: noHullMoney, accent: PALETTE.hull },
        ),
      );
      break;
    }
    case "ore-market": {
      const total = cargoValue(state.cargo);
      controls.push(
        control(
          frame.x + 28,
          frame.y + frame.h - 56,
          160,
          40,
          "sell",
          "SELL ALL",
          { disabled: total <= 0, accent: PALETTE.credits },
        ),
      );
      break;
    }
    case "upgrade-shop": {
      TRACKS.forEach((track, index) => {
        const price = nextUpgradePrice(state.tiers, track);
        const maxed = price === null;
        const y = frame.y + SHOP_ROWS.top + index * SHOP_ROWS.gap;
        controls.push(
          control(
            frame.x + frame.w - 124,
            y - 4,
            96,
            38,
            `buy:${track}`,
            maxed ? "MAX" : "BUY",
            { disabled: maxed || state.credits < (price ?? Infinity) },
          ),
        );
      });
      break;
    }
    case "supply-depot": {
      ITEMS.forEach((item, index) => {
        const y = frame.y + SUPPLY_ROWS.top + index * SUPPLY_ROWS.gap;
        controls.push(
          control(
            frame.x + frame.w - 118,
            y - 4,
            90,
            38,
            `buyitem:${item.id}`,
            "BUY",
            {
              disabled: state.credits < item.price,
              accent: PALETTE.credits,
            },
          ),
        );
      });
      break;
    }
    case "launch-pad": {
      const y = frame.y + frame.h - 108;
      if (allInstalled(state.installed)) {
        controls.push(
          control(frame.x + 28, y + 16, 200, 44, "launch", "LAUNCH", {
            accent: PALETTE.credits,
          }),
        );
      } else if (nextComponent(state.installed)) {
        controls.push(
          control(frame.x + 28, y + 16, 220, 44, "fabricate", "FABRICATE", {
            disabled: !canFabricate(state),
            accent: PALETTE.hull,
          }),
        );
      }
      break;
    }
    case "inventory": {
      const left = frame.x + 28;
      let y = frame.y + INVENTORY.oreTop;
      for (const mineral of MINERALS) {
        if (state.cargo[mineral.id] <= 0) continue;
        controls.push(
          control(left + 356, y - 18, 90, 28, `drop:${mineral.id}`, "DROP", {
            accent: PALETTE.alert,
          }),
        );
        y += INVENTORY.oreGap;
      }
      const right = frame.x + INVENTORY.rightOffset;
      ITEMS.forEach((item, index) => {
        const ry = frame.y + INVENTORY.supplyTop + index * INVENTORY.supplyGap;
        controls.push(
          control(
            right + INVENTORY.rightWidth - 100,
            ry - 19,
            100,
            30,
            `useitem:${item.id}`,
            "USE",
            {
              disabled: state.items[item.id] <= 0,
              accent: PALETTE.hull,
            },
          ),
        );
      });
      const afterSupplies =
        frame.y + INVENTORY.supplyTop + ITEMS.length * INVENTORY.supplyGap;
      controls.push(
        control(
          right,
          afterSupplies + 34,
          180,
          36,
          "jettison",
          "JETTISON [J]",
          {
            disabled: !state.satchel.coreSample,
            accent: PALETTE.coreSample,
          },
        ),
      );
      break;
    }
    default:
      break;
  }
  controls.push(closeControl(frame));
  return controls;
}

/** The control a point lands on, taking the last one drawn where they overlap. */
export function controlAt(
  controls: readonly Control[],
  x: number,
  y: number,
): Control | null {
  for (let i = controls.length - 1; i >= 0; i -= 1) {
    const c = controls[i];
    if (c.disabled) continue;
    if (x >= c.x && x <= c.x + c.w && y >= c.y && y <= c.y + c.h) return c;
  }
  return null;
}

/** Whether a point is inside a rectangle, which the drawing uses for hover. */
export function inside(
  c: { x: number; y: number; w: number; h: number },
  x: number,
  y: number,
): boolean {
  return x >= c.x && x <= c.x + c.w && y >= c.y && y <= c.y + c.h;
}
