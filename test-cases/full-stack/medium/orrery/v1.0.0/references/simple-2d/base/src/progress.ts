// Orrery — the three questions the drawing and the session both ask of the
// state (specs/modes/campaign.md, specs/modes/extras.md, specs/ui.md "The
// solved panel", specs/editor.md "Running the machine").
//
// All three are pure reads, and each is asked from two places: the session,
// deciding what a key press does, and the drawing, deciding what a row, a
// menu, and the heading say. They live here so each answer is written once and
// the picture can never disagree with what the key press will do.

import { challengeCount } from "./challenges";
import { SOLVED_ITEMS } from "./constants";
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
