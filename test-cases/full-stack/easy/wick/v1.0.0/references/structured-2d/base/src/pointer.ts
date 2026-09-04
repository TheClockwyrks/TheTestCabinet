// Wick — what the pointer does to a menu (specs/controls.md "The pointer").
//
// The three rules, applied on every frame from the single player controller
// after that frame's press edges and before the mode's tick: a hover moves the
// highlight, a primary click moves it and takes the item, and the wheel scrolls
// the almanac's list.
//
// The rectangles are `src/menus.ts`'s, which are the rectangles the renderer
// draws each item inside, so what a player clicks is what a player sees. What
// an item DOES is `src/flow.ts`'s `confirmItem`, the same routine `confirm`
// takes it through, so the pointer adds no second way for a menu to act.
//
// On `almanac` the list is a window over the tab's entries, so the rectangle
// at position `i` belongs to the entry at `menuIndex` `almanacScroll + i`; its
// tabs answer a click as `right` reaching them does, and its entries carry no
// confirmation, so a click on one only moves the highlight.

import { WHEEL_ROW } from "./constants";
import {
  confirmItem,
  highlightTo,
  scrollAlmanac,
  selectTab,
  type CueSink,
} from "./flow";
import type { PointerFrame } from "./input";
import { menuRects, rectAt, tabRects } from "./menus";
import type { WickState } from "./state";

/**
 * The `menuIndex` the stage point `(x, y)` selects, or `null` where no
 * rectangle holds it.
 */
export function highlightAt(
  state: WickState,
  x: number,
  y: number,
): number | null {
  const hit = rectAt(menuRects(state), x, y);
  if (hit < 0) return null;
  return state.screen === "almanac" ? state.almanacScroll + hit : hit;
}

/** Rule 1: the pointer inside an item's rectangle highlights that item. */
function hover(state: WickState, at: PointerFrame, sink: CueSink): void {
  const index = highlightAt(state, at.x, at.y);
  if (index !== null) highlightTo(state, index, sink);
}

/** Rule 2: a primary press edge highlights an item and then takes it. */
function click(state: WickState, at: PointerFrame, sink: CueSink): void {
  const press = at.press;
  if (press === null) return;
  const tab = rectAt(tabRects(state), press.x, press.y);
  if (tab >= 0) {
    selectTab(state, tab, sink);
    return;
  }
  const index = highlightAt(state, press.x, press.y);
  if (index === null) return;
  const onScreen = state.screen;
  highlightTo(state, index, sink);
  confirmItem(state, onScreen, sink);
}

/** Rule 3: on `almanac`, whole rows of wheel travel move the list. */
function wheel(state: WickState, at: PointerFrame): void {
  if (state.screen !== "almanac") return;
  scrollAlmanac(state, Math.trunc(at.wheel / WHEEL_ROW));
}

/** The three rules, in the order `specs/controls.md` states them. */
export function applyPointer(
  state: WickState,
  at: PointerFrame,
  sink: CueSink,
): void {
  hover(state, at, sink);
  click(state, at, sink);
  wheel(state, at);
}
