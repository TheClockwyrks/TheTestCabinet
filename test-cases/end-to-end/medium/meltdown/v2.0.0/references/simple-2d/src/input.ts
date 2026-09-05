// Meltdown — the actions this build registers, and how a frame reads them.
//
// specs/controls.md fixes the vocabulary and `src/constants.ts` fixes the keys,
// so this module is the binding between them and nothing more. Every action is
// read as a PRESS EDGE and fires once per press however long the key is held,
// which is what `api.input.pressed` gives: an edge armed once and consumed by
// the first read.
//
// Every edge is read exactly once per frame, in `readActions` below. Two
// readers of one action in one frame would split a single press between them.

import { ACTIONS, BINDINGS, type ActionName } from "./constants";
import type { InitApi, UpdateApi } from "@clockwyrks/simple-2d";
import type { MeltdownState } from "./game";

/** Register every action against the keys `BINDINGS` gives it. */
export function registerActions(api: InitApi<MeltdownState>): void {
  for (const action of ACTIONS) {
    api.input.register(action, { keys: [...BINDINGS[action]] });
  }
}

/** This frame's press edges, one flag per action. */
export type Edges = Readonly<Record<ActionName, boolean>>;

/** Read every action's edge once, in one place. */
export function readActions(api: UpdateApi): Edges {
  const edges: Partial<Record<ActionName, boolean>> = {};
  for (const action of ACTIONS) edges[action] = api.input.pressed(action);
  return edges as Edges;
}

/** The shop index `arm1` .. `arm8` name, or `null` for any other action. */
export function armIndexOf(action: ActionName): number | null {
  if (!action.startsWith("arm")) return null;
  const index = Number(action.slice(3));
  return Number.isFinite(index) ? index - 1 : null;
}
