// Carom — the menus under a mouse and under a finger (specs/ui.md).
//
// The engine hands the game every pointer sample of the frame in arrival order,
// already mapped through the same letterboxed fit `render` draws under, so a
// position the game reads and a region `menuItemRect` reports lie in ONE
// coordinate space. What is left is the rule, and the rule is small:
//
//   * A pointer that moves onto an item's region selects it; a contact that lands
//     on one, or travels onto one, selects it too. Nothing DESELECTS: a pointer
//     wandering off the menu leaves the highlight where it was, which is what
//     stops a menu flickering empty as a mouse crosses a gap.
//   * A confirm takes BOTH of its edges inside one item's region — the press and
//     its release for a pointer, the landing and the lift for a contact. Two edges
//     in different regions confirm nothing, which is the slide-off every
//     touch interface offers as a way to change your mind mid-press.
//
// The second rule is why `CaromState` carries `pointerPresses`: the two edges can
// arrive frames apart, so the item a press came down on has to be remembered
// until its release arrives. It is remembered per pointer id, because a second
// finger landing on the screen must not take the first one's press away.
//
// Samples are walked in ARRIVAL ORDER rather than collapsed to the frame's last
// position: a sweep that crossed three items between two frames visited them in
// an order, and the item it came to rest on is the one it ends on.

import type { PointerSample } from "@clockwyrks/simple-2d";
import type { CaromState, Screen } from "./game";
import { menuItemAt } from "./menus";
import { confirmMenuItem } from "./screens";
import type { DeepReadonly } from "ts-essentials";

/**
 * One pointer or touch contact currently pressed, and where it came down.
 *
 * `item` is the menu item the press landed in, or `-1` for a press that began
 * outside every region — which can never confirm, because a confirm needs both
 * edges inside one item.
 */
export interface PointerPress {
  /** The pointer this press belongs to. Each touch contact has its own. */
  readonly id: number;
  /** The item the press came down on, or `-1` for none. */
  readonly item: number;
  /** The screen it came down on; a press does not survive a screen change. */
  readonly screen: Screen;
}

/**
 * This frame's pointer and touch input applied to the menus.
 *
 * Pure over the samples, so the whole rule is testable without an engine, a
 * canvas, or a browser. It is applied AFTER the frame's keyboard edges
 * (specs/ui.md), so a frame carrying a keyboard movement edge and a pointer
 * selection ends on the item the pointer named.
 */
export function resolvePointer(
  state: DeepReadonly<CaromState>,
  samples: readonly PointerSample[],
): CaromState {
  let next: CaromState = state;
  let presses: PointerPress[] = [...state.pointerPresses];

  for (const sample of samples) {
    const item = menuItemAt(next.screen, sample.x, sample.y);

    if (sample.type === "down") {
      // One press per pointer: a second `down` from the same id replaces the
      // first rather than stacking.
      presses = presses.filter((press) => press.id !== sample.id);
      presses.push({ id: sample.id, item, screen: next.screen });
      if (item >= 0) next = { ...next, menuIndex: item };
      continue;
    }

    if (sample.type === "move") {
      if (item >= 0 && item !== next.menuIndex) {
        next = { ...next, menuIndex: item };
      }
      continue;
    }

    // A release: the second of the two edges a confirm needs.
    const press = presses.find((candidate) => candidate.id === sample.id);
    presses = presses.filter((candidate) => candidate.id !== sample.id);
    const confirms =
      press !== undefined &&
      press.screen === next.screen &&
      press.item >= 0 &&
      press.item === item;
    if (!confirms) continue;

    next = confirmMenuItem({ ...next, menuIndex: item }, item);
    // The menu this frame's remaining samples were aimed at is gone, and so is
    // every press that was resting on it.
    presses = [];
    break;
  }

  return { ...next, pointerPresses: presses };
}
