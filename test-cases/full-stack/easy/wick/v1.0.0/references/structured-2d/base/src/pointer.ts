// Wick — what the pointer and touch do to a menu (specs/controls.md "The
// pointer and touch").
//
// The rules, applied on every frame from the single player controller after
// that frame's press edges and before the mode's tick: a device out of contact
// hovers the item it rests in, a press arms the box it lands in, a release
// inside that same box takes what it armed, and the wheel scrolls the almanac's
// list. A touch contact reaches exactly the same rules: its landing is the
// press edge and its lift is the release edge, and it never hovers, because it
// reports no position out of contact.
//
// The rectangles are `src/menus.ts`'s, which are the rectangles the renderer
// draws each item inside, so what a player clicks or taps is what a player
// sees. What an item DOES is `src/flow.ts`'s `confirmItem`, the same routine
// `confirm` takes it through, so the pointer adds no second way for a menu to
// act.
//
// On `almanac` the list is a window over the tab's entries, so the rectangle
// at position `i` belongs to the entry at `menuIndex` `almanacScroll + i`; its
// tabs answer a press and release as `right` reaching them does, and its
// entries carry no confirmation, so taking one does nothing. `howto` and
// `chest` show no menu and answer one box each: `back`'s and `confirm`'s.

import { WHEEL_ROW } from "./constants";
import {
  closeChest,
  confirmItem,
  highlightTo,
  leaveHowto,
  scrollAlmanac,
  selectTab,
  type CueSink,
} from "./flow";
import type { PointerFrame, StagePoint } from "./input";
import { menuRects, rectAt, tabRects, type WickRect } from "./menus";
import type { Screen, WickState } from "./state";

/**
 * What a press armed, or `null`: the box its release has to lift inside.
 *
 * "A primary press edge inside the rectangle of the item at `menuIndex` `i` ...
 * arms that item. That press's release edge inside the same rectangle takes the
 * armed item" (specs/controls.md). The box is held with the target, because the
 * release only belongs to the same gesture when it lifts where the press
 * landed, and the screen with it, because leaving the screen takes the target
 * away. Like the contact in `src/input.ts` this is the DEVICE's state across
 * frames rather than the game's, so `WickState`, which `specs/state.md`
 * declares in full, does not carry it.
 */
interface Armed {
  readonly screen: Screen;
  readonly rect: WickRect;
  readonly kind: "item" | "tab";
  readonly index: number;
}

let armed: Armed | null = null;

/** Forget any armed gesture, so a fresh game starts with nothing armed. */
export function resetGesture(): void {
  armed = null;
}

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

/** Rule 1: a device out of contact inside an item's rectangle highlights it. */
function hover(state: WickState, at: StagePoint, sink: CueSink): void {
  const index = highlightAt(state, at.x, at.y);
  if (index !== null) highlightTo(state, index, sink);
}

/** Rule 2, first half: a press highlights the box it lands in and arms it. */
function press(state: WickState, at: StagePoint, sink: CueSink): void {
  armed = null;
  const screen = state.screen;
  const tabs = tabRects(state);
  const tab = rectAt(tabs, at.x, at.y);
  if (tab >= 0) {
    armed = { screen, rect: tabs[tab]!, kind: "tab", index: tab };
    return;
  }
  // The box is found before the highlight moves, because moving it on the
  // almanac can move the window under the very box the press landed in.
  const rects = menuRects(state);
  const position = rectAt(rects, at.x, at.y);
  if (position < 0) return;
  const rect = rects[position]!;
  const index =
    screen === "almanac" ? state.almanacScroll + position : position;
  highlightTo(state, index, sink);
  armed = { screen, rect, kind: "item", index };
}

/**
 * Take what a release inside its armed box armed: exactly what `confirm` on it
 * does, which on an almanac entry, the one menu that answers no `confirm`, is
 * nothing, and on `howto`, which answers no `confirm` either, is what `back`
 * there does.
 */
function take(state: WickState, sink: CueSink): void {
  if (state.screen === "howto") {
    leaveHowto(state);
    return;
  }
  if (state.screen === "chest") {
    closeChest(state);
    return;
  }
  confirmItem(state, state.screen, sink);
}

/**
 * Rule 2, second half: a release inside the box its press armed takes what it
 * armed; a release anywhere else disarms and takes nothing.
 */
function release(state: WickState, at: StagePoint, sink: CueSink): void {
  const gesture = armed;
  armed = null;
  if (gesture === null) return;
  if (gesture.screen !== state.screen) return;
  if (rectAt([gesture.rect], at.x, at.y) < 0) return;
  if (gesture.kind === "tab") {
    selectTab(state, gesture.index, sink);
    return;
  }
  take(state, sink);
}

/** Rule 4: on `almanac`, whole rows of wheel travel move the list. */
function wheel(state: WickState, frame: PointerFrame): void {
  if (state.screen !== "almanac") return;
  scrollAlmanac(state, Math.trunc(frame.wheel / WHEEL_ROW));
}

/** The rules, in the order `specs/controls.md` states them. */
export function applyPointer(
  state: WickState,
  frame: PointerFrame,
  sink: CueSink,
): void {
  if (frame.at !== null) hover(state, frame.at, sink);
  for (const at of frame.presses) press(state, at, sink);
  for (const at of frame.releases) release(state, at, sink);
  wheel(state, frame);
}
