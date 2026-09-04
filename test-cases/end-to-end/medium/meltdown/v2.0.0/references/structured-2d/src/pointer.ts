// Meltdown — the pointer, resolved through one path.
//
// There is one pointer button and the game asks for no other
// (specs/controls.md), so what a press and release does is decided entirely by
// where it lands and by what is armed. This module is that decision, and it is
// the ONLY place it is made: the player controller feeds it the engine's own
// samples, and the debug surface's `pointerDown`, `pointerMove` and `pointerUp`
// feed it the same calls, so a posed press and a player's press are the same
// event resolved by the same code.
//
// Nothing here plays a cue. A resolution raises flags, and the caller decides
// whether the frame it belongs to is a frame at all: the controller plays them,
// and the debug surface — which resolves outside the frame loop — does not.

import {
  armType,
  movePreview,
  placeHeld,
  previewTileFor,
  rotatePreview,
  sellTowerById,
  towerAtPoint,
  upgradeTowerById,
} from "./build";
import { noCues, type CueFlags } from "./audio";
import { FLOOR_X0, FLOOR_X1, FLOOR_Y0, FLOOR_Y1 } from "./constants";
import { confirmMenu, togglePause } from "./flow";
import { hitPanel, menuRowAt } from "./layout";
import { sendWave } from "./run";
import type { MeltdownState } from "./game";

/** What one pointer call resolved to. */
export interface InputResult {
  /** The cues the call would raise, if the caller is a frame. */
  cues: CueFlags;
  /** Whether the call asked the runtime to toggle its mute bit. */
  mute: boolean;
}

/** A call that resolved to nothing. */
export function noResult(): InputResult {
  return { cues: noCues(), mute: false };
}

/** Whether a stage position lies on the reactor floor. */
export function onFloor(x: number, y: number): boolean {
  return x >= FLOOR_X0 && x < FLOOR_X1 && y >= FLOOR_Y0 && y < FLOOR_Y1;
}

/** Carry the held preview to the pointer, when one is held and it is on the floor. */
function carryPreview(state: MeltdownState, x: number, y: number): void {
  const build = state.build;
  if (build === null) return;
  if (!onFloor(x, y)) return;
  const at = previewTileFor(build.type, x, y);
  movePreview(state, at.col, at.row);
}

/** A press at a stage position. */
export function pointerDown(
  state: MeltdownState,
  x: number,
  y: number,
): InputResult {
  state.pointer = { x, y, down: true };
  if (state.screen === "playing") carryPreview(state, x, y);
  return noResult();
}

/**
 * A move to a stage position. It carries the held preview over the floor and
 * marks the shop entry under it as hovered, and it arms and selects nothing.
 */
export function pointerMove(
  state: MeltdownState,
  x: number,
  y: number,
): InputResult {
  state.pointer = { x, y, down: state.pointer.down };
  if (state.screen !== "playing") return noResult();
  carryPreview(state, x, y);
  const hit = hitPanel(state, x, y);
  state.hoverShop = hit !== null && hit.kind === "shop" ? hit.type : null;
  return noResult();
}

/** Operate one of the panel's controls. */
function operatePanel(
  state: MeltdownState,
  hit: ReturnType<typeof hitPanel>,
): InputResult {
  const result = noResult();
  if (hit === null) return result;
  switch (hit.kind) {
    case "shop":
      // A tap both arms the type and marks it hovered, so the same panel a
      // mouse reads on hover is reached by tap (specs/controls.md, Touch).
      armType(state, hit.type);
      state.hoverShop = hit.type;
      return result;
    case "rotate":
      rotatePreview(state);
      return result;
    case "cancel":
      armType(state, null);
      return result;
    case "upgrade":
      if (state.selected !== null) upgradeTowerById(state, state.selected);
      return result;
    case "sell":
      if (state.selected !== null && sellTowerById(state, state.selected)) {
        result.cues.sell = true;
      }
      return result;
    case "send":
      sendWave(state);
      return result;
    case "speed":
      state.speed = state.speed === 1 ? 2 : 1;
      return result;
    case "pause":
      togglePause(state);
      return result;
    case "mute":
      result.mute = true;
      return result;
  }
}

/**
 * A release. On a menu screen it takes the row under it; on the floor it
 * places, selects, or deselects; on the panel it operates the control it
 * landed on.
 */
export function pointerUp(
  state: MeltdownState,
  x = state.pointer.x,
  y = state.pointer.y,
): InputResult {
  state.pointer = { x, y, down: false };

  if (state.screen !== "playing") {
    const row = menuRowAt(state.screen, x, y);
    if (row === null) return noResult();
    const result = noResult();
    // The row becomes the highlighted row and is then taken, exactly as a
    // confirm on it does, so a tap that moved the highlight sounds the cue a
    // move sounds (specs/controls.md).
    if (row !== state.menuIndex) {
      state.menuIndex = row;
      result.cues.menu = true;
    }
    confirmMenu(state);
    return result;
  }

  const hit = hitPanel(state, x, y);
  if (hit !== null) return operatePanel(state, hit);

  if (!onFloor(x, y)) return noResult();

  if (state.build !== null) {
    const result = noResult();
    if (placeHeld(state)) result.cues.place = true;
    return result;
  }

  state.selected = towerAtPoint(state, x, y)?.id ?? null;
  return noResult();
}
