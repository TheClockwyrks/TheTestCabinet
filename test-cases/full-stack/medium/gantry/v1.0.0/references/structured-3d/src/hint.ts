// What a click at the pointer would do, in a line.
//
// `specs/ui.md` asks that a refused edit be visible in the moment it is
// refused. The editor's rules are pure of everything but the state, so the
// cheapest honest way to say why a click will do nothing is to ask them:
// `applyClick` is run, its answer is read, and everything it touched is put
// back. A player therefore reads the refusal before the click as well as after
// it.
//
// The engine's state is live rather than replaced, so the reading is bracketed
// rather than taken on a copy: the four fields an edit writes — the open site's
// structure, the undo history, the pending node, and the shown check result —
// are held before the call and written back after it, inside a `finally`, so
// the state this returns to is the state it was handed.

import { applyClick, pick, type EditOutcome, type Pick } from "./editor";
import type { EditRefusal } from "./sim";
import type { GantryState, Vec3 } from "./game";

/**
 * What a click at the pointer would do on the build screen. Both fields are
 * `null` on every other screen and wherever the pointer picks nothing.
 */
export interface PointerHint {
  /** What a click would place or remove, in a few words. */
  readonly action: string | null;
  /** The rule that would refuse it. */
  readonly refusal: EditRefusal | null;
}

/** Nothing under the pointer, which is every screen but `build`. */
export const NO_HINT: PointerHint = { action: null, refusal: null };

/** What a click would take on a screen where a click takes nothing. */
const NOTHING_PICKED: Pick = { node: null, member: null };

/** Whether the pointer hint has anything to show. */
export const hasHint = (hint: PointerHint): boolean =>
  hint.action !== null || hint.refusal !== null;

const nodeText = (node: Vec3): string => `(${node.x}, ${node.y}, ${node.z})`;

const BAR_TOOLS = new Set(["strut", "cable", "rail"]);

/** Run the editor's own rules over the state and leave the state as it was. */
function wouldEdit(state: GantryState): EditOutcome {
  const entry = state.sites[state.siteIndex];
  const structure = entry.structure;
  // `commit` pushes the history in place, so what is held is a copy of it.
  const history = [...state.history];
  const pendingNode = state.pendingNode;
  const checkResult = state.checkResult;
  try {
    return applyClick(state);
  } finally {
    entry.structure = structure;
    state.history = history;
    state.pendingNode = pendingNode;
    state.checkResult = checkResult;
  }
}

/**
 * The line the build screen shows under the pointer.
 *
 * The pick is taken here unless the caller has one already — projecting every
 * lattice node is the dearest thing a frame does, and the frame's reading takes
 * one anyway (`src/actor-view.ts`).
 */
export function pointerHint(
  state: GantryState,
  picked: Pick = state.screen === "build" ? pick(state) : NOTHING_PICKED,
): PointerHint {
  if (state.screen !== "build") return NO_HINT;
  const outcome = wouldEdit(state);
  if (outcome.refusal !== null) {
    return { action: null, refusal: outcome.refusal };
  }
  return { action: actionText(state, outcome, picked), refusal: null };
}

function actionText(
  state: GantryState,
  outcome: EditOutcome,
  picked: Pick,
): string | null {
  const tool = state.tool;
  if (outcome.cue === "place") {
    if (tool === "ring") return "CLICK TO SET THE SLEW RING HERE";
    if (tool === "counterweight") return "CLICK TO HANG A COUNTERWEIGHT HERE";
    return `CLICK TO PLACE A ${tool.toUpperCase()}`;
  }
  if (outcome.cue === "delete") {
    if (tool === "counterweight") return "CLICK TO TAKE THIS COUNTERWEIGHT OFF";
    return "CLICK TO DELETE WHAT IS UNDER THE POINTER";
  }
  if (picked.node !== null && BAR_TOOLS.has(tool)) {
    return state.pendingNode === null
      ? `CLICK TO HOLD ${nodeText(picked.node)}`
      : "CLICK AGAIN TO DROP THE HELD NODE";
  }
  return null;
}
