// Shatter — the menus under a mouse and under a finger (`specs/ui.md`).
//
// The runtime hands the game every pointer sample of the frame in arrival order,
// already mapped through the same letterboxed fit `render` draws under, so a
// position read here and a region `menus.ts` reports lie in ONE coordinate
// space. What is left is the rule, and the rule is small:
//
//   * A pointer that moves onto an entry's region highlights it; a contact that
//     lands on one, or travels onto one, highlights it too. Nothing UNhighlights:
//     a pointer wandering off the menu leaves the highlight where it was, which
//     is what stops a menu flickering empty as a mouse crosses a gap.
//   * A confirm takes BOTH of its edges inside one entry's region — the press and
//     its release for a pointer, the landing and the lift for a contact. Two
//     edges in different regions confirm nothing, which is the slide-off every
//     touch interface offers as a way to change your mind mid-press.
//
// The second rule is why the state carries `pointerPresses`: the two edges can
// arrive frames apart, so the entry a press came down on is remembered until its
// release arrives, per pointer id so a second finger cannot take the first one's
// press away.
//
// SAMPLES ARE WALKED IN ARRIVAL ORDER rather than collapsed to the frame's last
// position: a sweep that crossed three entries between two frames visited them in
// an order, and the entry it came to rest on is the one it ends on.

import { menuItemAt } from "./menus";
import type { PointerSample } from "./pointer";
import type { ShatterState } from "./types";

/**
 * This frame's pointer and touch samples applied to the menu on show.
 *
 * `confirm` is the same routine the key's confirm edge takes, handed in rather
 * than imported so this file stands clear of the frame's own module. Called
 * after the frame's key edges (`specs/ui.md`), so a frame carrying a key
 * movement edge and a pointer selection ends on the entry the pointer named.
 */
export function resolvePointer(
  state: ShatterState,
  samples: readonly PointerSample[],
  confirm: (state: ShatterState, index: number) => void,
): void {
  for (const sample of samples) {
    const entry = menuItemAt(state.screen, sample.x, sample.y);

    if (sample.type === "down") {
      // One press per pointer: a second `down` from the same id replaces the
      // first rather than stacking.
      state.pointerPresses = state.pointerPresses.filter(
        (press) => press.id !== sample.id,
      );
      state.pointerPresses.push({
        id: sample.id,
        entry,
        screen: state.screen,
      });
      if (entry >= 0) state.menuIndex = entry;
      continue;
    }

    if (sample.type === "move") {
      if (entry >= 0) state.menuIndex = entry;
      continue;
    }

    // A release: the second of the two edges a confirm needs.
    const press = state.pointerPresses.find(
      (candidate) => candidate.id === sample.id,
    );
    state.pointerPresses = state.pointerPresses.filter(
      (candidate) => candidate.id !== sample.id,
    );
    const confirms =
      press !== undefined &&
      press.screen === state.screen &&
      press.entry >= 0 &&
      press.entry === entry;
    if (!confirms) continue;

    state.menuIndex = entry;
    confirm(state, entry);
    // The menu this frame's remaining samples were aimed at is gone, and so is
    // every press that was resting on it.
    state.pointerPresses = [];
    return;
  }
}
