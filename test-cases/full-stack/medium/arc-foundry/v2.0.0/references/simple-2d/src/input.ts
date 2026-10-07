// Arc Foundry — input, as engine actions (specs/controls.md).
//
// The game never sees a `KeyboardEvent` or a `PointerEvent`. It declares the named
// actions `src/constants.ts` fixes against the keys that drive them, and the engine does
// the listening, the edge detection, and the mapping of a pointer position into the
// stage's logical units. Every reader below is one line over `UpdateApi.input`.
//
// AN EDGE IS CONSUMED BY THE FIRST CALL THAT SEES IT, so each action is read in exactly
// one place per frame: `handleInput` in `src/game.ts`. `modify` is the one exception and
// is deliberately read as a LEVEL rather than an edge, because it stands for no control
// of its own and only modifies the press it is held across, which means it is read
// wherever a press is resolved and never consumes anything.

import { ACTIONS, BINDINGS, LAYOUT, type ActionName } from "./constants";
import type { InitApi, UpdateApi } from "@clockwyrks/simple-2d";

/**
 * Register every action against its keys.
 *
 * The engine's layout is checked first, so an engine stood up without the layout this
 * build speaks fails loudly at start-up rather than shipping menus no key can move. The
 * action list is deliberately wider than that layout's vocabulary: the build controls,
 * the speed and overlay toggles, and `modify` are Arc Foundry's own and sit beyond it.
 */
export function registerActions(api: Pick<InitApi, "input">): void {
  const layout = api.input.layout();
  if (layout === null || layout.name !== LAYOUT) {
    throw new Error(
      `Arc Foundry: the engine must be built with the ${LAYOUT} layout` +
        (layout ? `, not ${layout.name}` : ""),
    );
  }
  for (const action of ACTIONS) {
    api.input.register(action, { keys: [...BINDINGS[action]] });
  }
}

/** Whether an action was pressed since the last frame. The call consumes the edge. */
export function pressed(
  api: Pick<UpdateApi, "input">,
  action: ActionName,
): boolean {
  return api.input.pressed(action);
}

/**
 * Whether `modify` is held right now.
 *
 * A level rather than an edge, so reading it neither consumes anything nor depends on
 * the frame the key went down in.
 */
export function modifyHeld(api: Pick<UpdateApi, "input">): boolean {
  return api.input.value("modify") > 0;
}
