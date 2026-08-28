// Fathom — input, as engine actions (`specs/movement.md`).
//
// The game never sees a `KeyboardEvent`. It declares the ten NAMED ACTIONS
// `src/constants.ts` lists, bound to the keys that drive them, and the engine
// does the listening, the edge detection and the binding. Two consequences shape
// this file:
//
//   * A held read (`value`) is what drives the forager, because it travels while
//     a movement action is held. An edge read (`pressed`) is what fires the
//     pulse, the ink, a menu move, a confirm, a pause and the mute, exactly once
//     per press.
//   * An edge is consumed by the first call that sees it and is discarded at the
//     end of the frame it was armed in. So each edge is read in exactly ONE place
//     per frame, and each screen reads only the actions its own row of
//     `specs/movement.md` gives it — which is what keeps `Space` meaning the
//     pulse in play and the confirm on a menu.

import { ACTIONS, BINDINGS, LAYOUT, type ActionName } from "./constants";
import { DIRS } from "./grid";
import type { Dir, Heading } from "./state";
import type { InitApi, UpdateApi } from "@test-cabinet/simple-2d";

/**
 * Register every action, bound to its keys.
 *
 * The engine's own layout vocabulary is checked against `ACTIONS` first, so an
 * action the layout speaks and this build forgot is a hard failure at start-up
 * rather than a control that silently does nothing.
 */
export function registerActions(api: Pick<InitApi<never>, "input">): void {
  const layout = api.input.layout();
  if (layout === null) {
    throw new Error(
      `Fathom: the engine was built without the ${LAYOUT} layout`,
    );
  }
  if (layout.actions.join() !== ACTIONS.join()) {
    throw new Error(
      `Fathom: the ${layout.name} layout speaks [${layout.actions.join(", ")}], ` +
        `but this build registers [${ACTIONS.join(", ")}]`,
    );
  }
  for (const action of ACTIONS) {
    api.input.register(action, { keys: [...BINDINGS[action]] });
  }
}

/**
 * The movement actions held this frame.
 *
 * The four action names are the four directions, so a held action IS a heading.
 */
export function heldDirections(api: UpdateApi): Dir[] {
  return DIRS.filter((dir) => api.input.value(dir) > 0);
}

/**
 * The forager's desired direction after this frame's controls
 * (`specs/movement.md`).
 *
 * A movement action sets it and it holds until another movement action replaces
 * it, so releasing every key leaves it standing. A direction newly pressed wins,
 * which is what lets a player turn while still holding the direction they were
 * traveling in.
 */
export function desiredDirection(
  desired: Heading,
  before: readonly Dir[],
  now: readonly Dir[],
): Heading {
  const fresh = now.filter((dir) => !before.includes(dir));
  if (fresh.length > 0) return fresh[fresh.length - 1];
  if (desired !== null && now.includes(desired)) return desired;
  if (now.length > 0) return now[0];
  return desired;
}

function pressed(api: UpdateApi, action: ActionName): boolean {
  return api.input.pressed(action);
}

/** The sonar pulse. */
export function sonarPressed(api: UpdateApi): boolean {
  return pressed(api, "a");
}

/** The ink cloud. */
export function inkPressed(api: UpdateApi): boolean {
  return pressed(api, "b");
}

export function pausePressed(api: UpdateApi): boolean {
  return pressed(api, "pause");
}

export function mutePressed(api: UpdateApi): boolean {
  return pressed(api, "mute");
}

export function menuUp(api: UpdateApi): boolean {
  return pressed(api, "up");
}

export function menuDown(api: UpdateApi): boolean {
  return pressed(api, "down");
}

export function confirmPressed(api: UpdateApi): boolean {
  return pressed(api, "confirm");
}

export function backPressed(api: UpdateApi): boolean {
  return pressed(api, "back");
}
