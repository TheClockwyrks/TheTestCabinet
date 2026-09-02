// Orrery — the editor screen's hands: what a pointer sample and an editing key
// do to the machine (specs/editor.md, specs/controls.md).
//
// The focus rule is here because specs/controls.md fixes it over the whole
// screen rather than over any one region: a press inside the tape panel's
// extent sets the focus to `tape`, a press anywhere else on the editor sets it
// to `field`, and the focus is what routes `KeyW` and `KeyS` to `part-grow`
// and `part-shrink` or to `ins-extend` and `ins-retract`.
//
// SEAM: the tray, the drags and their ghosts, laying track, the tape panel's
// cursor and its two macros, and the undo and redo histories land with the
// editor phase of this build. They are written into the two entry points
// below, which the runtime, the keyboard, and the debug surface's pointer
// operations all already reach the editor through — so a press posed from code
// and a press made by hand run down one path, as
// specs/instrumentation.md requires.

import { TAPE_Y0, TRAY_REGION_W, type Action } from "./constants";
import type { PointerSample } from "./pointer";
import type { OrreryState } from "./types";

/**
 * Whether a stage position lies inside the tape panel's extent,
 * `x >= TRAY_REGION_W` and `y >= TAPE_Y0` (specs/controls.md "Focus"). Every
 * rectangle this game fixes includes its lower bound and excludes its upper.
 */
export function insideTapePanel(x: number, y: number): boolean {
  return x >= TRAY_REGION_W && y >= TAPE_Y0;
}

/**
 * Resolve one pointer sample against the editor, in the order the samples
 * arrived. A press sets the focus wherever it lands; what it targets is the
 * editor phase's.
 */
export function applyPointerSample(
  state: OrreryState,
  sample: PointerSample,
): void {
  if (state.screen !== "editor") return;
  if (sample.type === "down") {
    state.editor.focus = insideTapePanel(sample.x, sample.y) ? "tape" : "field";
  }
}

/**
 * Resolve one editing action against the machine. The run controls and the
 * menus are the game's; this is the half specs/controls.md routes by focus.
 */
export function applyEditorAction(_state: OrreryState, _action: Action): void {}
