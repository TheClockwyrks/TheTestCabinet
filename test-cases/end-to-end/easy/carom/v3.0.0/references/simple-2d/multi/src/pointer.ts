// Carom — the menus under a mouse and under a finger (specs/ui.md).
//
// The engine maps every pointer into the game's own logical coordinates, through
// the same letterboxed fit the game draws under (`engine/input.md`), so a
// position read here and a region reported by `menuItemRect` lie in one
// coordinate space and no mapping happens in this build at all.
//
// What the specification fixes, and what this module is:
//
//   * A POINTER selects by MOVING ONTO an item. A mouse hovers, so a move is what
//     names the item under it; a press alone names nothing.
//   * A TOUCH CONTACT selects by LANDING inside an item as well as by travelling
//     onto one. A finger cannot hover, so its landing has to do the work a
//     mouse's hover does.
//   * A CONFIRM takes BOTH of its edges inside ONE item: the press and its
//     release, the landing and its lift. A press begun on one item and ended on
//     another confirms nothing, and neither does an edge outside every region.
//
// The last of those is why `CaromState` carries the presses: the two edges may
// arrive on different frames, so where a press landed has to survive to the frame
// its release arrives on. Everything else is read fresh from this frame's
// samples.
//
// The samples rather than the snapshot are what is read, because a sweep that
// crossed several items between two frames arrives as the ordered positions it
// visited: the item it ENDED on is the one it selected, and the item it merely
// passed over is not. Reading `pointerSamples()` does not consume anything, so
// this read costs the keyboard nothing.

import { menuFor, menuItemAt } from "./menu";
import type { CaromState, PointerPress } from "./game";
import type { UpdateApi } from "@clockwyrks/simple-2d";
import type { DeepReadonly } from "ts-essentials";

/** What one frame of pointer and touch input did to a menu. */
export interface PointerMenuResult {
  /** The highlighted item after this frame's pointer and touch input. */
  readonly menuIndex: number;
  /** The presses still waiting for a release. */
  readonly presses: readonly PointerPress[];
  /** Whether an item was confirmed, which is the item at `menuIndex`. */
  readonly confirmed: boolean;
}

/**
 * This frame's pointer and touch samples resolved against the current screen's
 * menu.
 *
 * The state is left as it was: the caller folds the result into the state it
 * builds, after the frame's keyboard edges, which is the order specs/ui.md
 * fixes.
 */
export function readPointerMenu(
  state: DeepReadonly<CaromState>,
  api: UpdateApi,
): PointerMenuResult {
  const layout = menuFor(state.screen);
  const samples = api.input.pointerSamples();
  if (layout === null) {
    // No menu is showing, so nothing here can be selected or confirmed, and a
    // press waiting on this screen has nothing left to confirm.
    return { menuIndex: state.menuIndex, presses: [], confirmed: false };
  }

  let presses: PointerPress[] = state.presses.map((press) => ({ ...press }));
  let menuIndex = state.menuIndex;
  let confirmed = -1;

  for (const sample of samples) {
    const index = menuItemAt(state.screen, sample.x, sample.y);
    if (sample.type === "down") {
      // A pointer may only ever be down once at a time, so a landing replaces
      // whatever this id was still waiting on.
      presses = presses.filter((press) => press.id !== sample.id);
      presses.push({ id: sample.id, index, screen: state.screen });
      // A finger does not hover: its landing is what selects.
      if (sample.device === "touch" && index >= 0) menuIndex = index;
      continue;
    }
    if (sample.type === "move") {
      // Moving onto an item selects it, held button or not. Moving off one onto
      // no item leaves the selection where it was.
      if (index >= 0) menuIndex = index;
      continue;
    }
    // A release: it confirms only when it lands inside the very item its own
    // press landed in, on the same screen.
    const origin = presses.find((press) => press.id === sample.id) ?? null;
    presses = presses.filter((press) => press.id !== sample.id);
    if (
      origin !== null &&
      origin.screen === state.screen &&
      origin.index >= 0 &&
      origin.index === index
    ) {
      menuIndex = index;
      confirmed = index;
    }
  }

  return {
    menuIndex: confirmed >= 0 ? confirmed : menuIndex,
    presses,
    confirmed: confirmed >= 0,
  };
}
