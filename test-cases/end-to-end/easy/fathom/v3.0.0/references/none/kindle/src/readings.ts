// Fathom — the readings derived from the state.
//
// Every quantity the specification defines as derived rather than held: the
// light radius `V` and the vision circle's radius `R` from the brightness `G`,
// the sonar range `E` from the depth, the roster a depth holds, and whether a
// predator's body is being drawn this instant. They live apart from
// `src/game.ts` because the renderer, the snapshot and the overlay all ask them
// of a state the game owns, and none of those three should have to reach into
// the game to work them out.

import {
  DEN_ORDER,
  GAMEOVER_ITEMS,
  KINDLE_VISION_GAIN,
  KINDLE_VISION_MIN,
  PAUSE_ITEMS,
  ROSTER_ADD_ORDER,
  SONAR_RANGE_BASE,
  SONAR_RANGE_MIN,
  TITLE_ITEMS,
  VISION_GAIN,
  VISION_MIN,
} from "./constants";
import type { Predator } from "./entities";
import type { FathomState } from "./game";
import { COUNTDOWN_STEP } from "./theme";
import type { PredatorKind, Screen } from "./types";

/** The light pocket's radius `V`, derived from the brightness `G`. */
export function visionRadius(state: FathomState): number {
  return VISION_MIN + VISION_GAIN * state.forager.brightness;
}

/**
 * The vision circle's radius `R`, derived from the same brightness `G`.
 *
 * It is wider than the light pocket at every `G` and it senses nothing: the
 * renderer masks the maze to it, and no other reader consults it.
 */
export function windowRadius(state: FathomState): number {
  return KINDLE_VISION_MIN + KINDLE_VISION_GAIN * state.forager.brightness;
}

/** The sonar pulse's path range `E` at a depth, in corridor steps. */
export function sonarRange(depth: number): number {
  return Math.max(SONAR_RANGE_MIN, SONAR_RANGE_BASE - (depth - 1));
}

/**
 * The roster a depth holds, in release order: one of each kind at depth 1, one
 * more per depth beyond that, and a cap of two of each from depth 4 on.
 */
export function roster(depth: number): PredatorKind[] {
  const kinds = [...DEN_ORDER];
  const extra = Math.min(Math.max(depth - 1, 0), ROSTER_ADD_ORDER.length);
  for (let i = 0; i < extra; i += 1) kinds.push(ROSTER_ADD_ORDER[i]);
  return kinds;
}

/**
 * Whether a predator's body is drawn this instant: by the forager's own light,
 * by a live sonar mark, by a flare, or by its own detection alert. A predator in
 * the den is drawn nowhere, whatever the light is doing.
 */
export function predatorLit(state: FathomState, p: Predator): boolean {
  if (p.state === "den") return false;
  if (p.alertT > 0) return true;
  // A pulse marks the Gloamfin and the Flarefish. The Lanternjaw is one of the
  // maze's amber lights, so a pulse leaves it exactly as it was — and a crest
  // washing over the tile it stands on lights the ground, not the hunter.
  if (p.kind !== "lanternjaw" && p.markT > 0) return true;
  return state.fog.showsBodies(p.col, p.row);
}

/** Whether the maze itself is on screen, which is what the HUD is drawn over. */
export function mazeOnScreen(screen: Screen): boolean {
  return (
    screen === "countdown" ||
    screen === "playing" ||
    screen === "paused" ||
    screen === "cleared"
  );
}

/** The items of the menu a screen carries; a screen with none carries none. */
export function menuItems(screen: Screen): readonly string[] {
  switch (screen) {
    case "title":
      return TITLE_ITEMS;
    case "paused":
      return PAUSE_ITEMS;
    case "gameover":
      return GAMEOVER_ITEMS;
    default:
      return [];
  }
}

/** The number the dive countdown is showing, counting down to one. */
export function countdownNumber(remaining: number): number {
  return Math.max(1, Math.ceil(remaining / COUNTDOWN_STEP));
}
