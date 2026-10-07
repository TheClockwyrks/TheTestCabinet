// Orrery — the questions the drawing and the session both ask of the state
// (specs/modes/campaign.md, specs/modes/extras.md, specs/ui.md "The solved
// panel", "Menu navigation", specs/editor.md "Running the machine").
//
// Every one is a pure read, and each is asked from two places: the session,
// deciding what a key press or a pointer edge does, and the drawing, deciding
// what a row, a menu, and the heading say. They live here so each answer is
// written once and the picture can never disagree with what the input will do.
//
// The menu reads at the foot are the same bargain over the layout of
// `src/regions.ts`: which menu the current screen shows, where one of its
// items sits, and which item a stage position lies in. The debug surface's
// `menuItemRect` is the second of them, exactly as a check reaches it
// (specs/instrumentation.md "The menu layout"), so what the surface reports,
// what the screen draws, and what a press selects cannot come apart.

import { challengeCount } from "./challenges";
import { SOLVED_ITEMS, TITLE_ITEMS } from "./constants";
import {
  menuItemRectOf,
  rectHolds,
  type MenuItemRect,
  type MenuKind,
} from "./regions";
import { solvedOf } from "./state";
import type { Mode, OrreryState } from "./types";

/** Whether a mode's challenge at `index` may be entered from its select row. */
export function enterable(
  state: OrreryState,
  mode: Mode,
  index: number,
): boolean {
  if (index < 0 || index >= challengeCount(mode)) return false;
  if (mode === "extras") return true;
  return (
    index < state.unlockedCount || solvedOf(state, "campaign").includes(index)
  );
}

/** The solved panel's menu: `NEXT CHALLENGE` only when a next one exists. */
export function solvedItems(state: OrreryState): string[] {
  const ref = state.challengeRef;
  const hasNext = ref !== null && ref.index + 1 < challengeCount(ref.mode);
  return SOLVED_ITEMS.filter((item) => item !== "NEXT CHALLENGE" || hasNext);
}

/**
 * Which of the open challenge's rises and sets the machine is still missing.
 * Empty is what the `play` action requires (specs/editor.md "Running the
 * machine"), and the heading names what is outstanding.
 */
export function missingApertures(state: OrreryState): string[] {
  const challenge = state.challenge;
  if (challenge === null) return [];
  const missing: string[] = [];
  challenge.reagents.forEach((_molecule, index) => {
    const placed = state.editor.parts.some(
      (part) => part.kind === "rise" && part.index === index,
    );
    if (!placed) missing.push(`rise ${index + 1}`);
  });
  challenge.products.forEach((_molecule, index) => {
    const placed = state.editor.parts.some(
      (part) => part.kind === "set" && part.index === index,
    );
    if (!placed) missing.push(`set ${index + 1}`);
  });
  return missing;
}

/**
 * Whether the `play` action starts a run: a challenge is open and every rise
 * and every set of it is placed (specs/editor.md "Running the machine").
 */
export function machineReady(state: OrreryState): boolean {
  if (state.challenge === null) return false;
  return missingApertures(state).length === 0;
}

/** The menu a screen shows: which one it is, and how many items it carries. */
export interface Menu {
  readonly kind: MenuKind;
  readonly count: number;
}

/**
 * The menu the current screen shows, and `null` where it shows none: the title
 * menu on `title`, the how-to's single item on `howto`, the rows of the
 * current mode's select screen on `select`, and the solved panel's items on
 * `editor` while the run is `complete` (specs/instrumentation.md "The menu
 * layout"). The editor shows none while editing and none while a run is
 * `running`, `paused`, or `faulted`.
 *
 * The select screen's count is its mode's whole course, locked rows included:
 * locking is what `confirm` does with a row, not whether the row is laid out.
 */
export function menuOf(state: OrreryState): Menu | null {
  switch (state.screen) {
    case "title":
      return { kind: "title", count: TITLE_ITEMS.length };
    case "howto":
      return { kind: "howto", count: 1 };
    case "select":
      return { kind: "select", count: challengeCount(state.mode) };
    case "editor":
      return state.sim?.status === "complete"
        ? { kind: "solved", count: solvedItems(state).length }
        : null;
  }
}

/**
 * The hit region of item `index` of that menu, in logical stage units, and
 * `null` where the screen shows no menu or `index` names no item of it — an
 * index outside the menu is answered rather than refused, as
 * specs/instrumentation.md states. It reads the state and changes nothing.
 */
export function menuItemRect(
  state: OrreryState,
  index: number,
): MenuItemRect | null {
  const menu = menuOf(state);
  if (menu === null) return null;
  if (!Number.isInteger(index) || index < 0 || index >= menu.count) return null;
  return menuItemRectOf(menu.kind, index, menu.count);
}

/** The item of `menu` a stage position lies in, and `null` outside every one. */
export function menuItemAt(menu: Menu, x: number, y: number): number | null {
  for (let index = 0; index < menu.count; index += 1) {
    if (rectHolds(menuItemRectOf(menu.kind, index, menu.count), x, y)) {
      return index;
    }
  }
  return null;
}
