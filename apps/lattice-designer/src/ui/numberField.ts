// When a numeric field's typing reaches the model.
//
// A field over a live value has no submit to hold the text until, so the obvious
// thing is to commit the instant the typing names a value in range. For a field
// that only tunes something — a source's period — that is exactly right: the sim
// replays and you see the answer as you type.
//
// It is wrong for a field that RESTRUCTURES the design. Replacing a board width of
// 12 with 64 is "select all, 6, 4", and 6 is a perfectly legal width, so a
// keystroke-committing field resizes the board to 6 on the way past — a structural
// change, from a keystroke nobody meant as a value. This module is the other
// discipline: the typing is held, and only leaving the field (blur) or pressing
// Enter commits it, with Escape abandoning the edit. The console's Ladder priority
// field is written the same way, for the same reason.
//
// The reading of the text is NOT re-implemented here: `readNumberField` (the
// console's `numberFieldRules`, aliased as `@numeric`) stays the single judge of
// what a piece of typing names and why it is refused. This only decides *when* the
// answer is applied, and it is a pure step function so the rule can be tested
// without a DOM.

import { readNumberField, type NumberFieldBounds } from "@numeric";

/** Something that happened to a held field. */
export type FieldEvent =
  /** A keystroke. The text is kept verbatim, whatever it says. */
  | { type: "type"; raw: string }
  /** The edit is finished with — a blur, or Enter. */
  | { type: "commit" }
  /** The edit is abandoned — Escape. */
  | { type: "revert" };

/** What the field holds after an event, and what the event committed. */
export interface FieldStep {
  /** The text the field now holds; `null` means it mirrors the committed value. */
  draft: string | null;
  /** The value to apply, or `null` when this event applies nothing. */
  commit: number | null;
}

/**
 * Step a held numeric field.
 *
 * `draft` is the typing so far (`null` when the field is idle) and `value` is the
 * committed value it was typed over. A commit that names nothing usable — empty,
 * out of range, not a number — restores the committed value instead, so a field
 * cleared and walked away from does not push a floor into the model. A commit that
 * names the value already held applies nothing, which keeps a blur from restarting
 * the sim on a field nobody changed.
 */
export function stepNumberField(
  draft: string | null,
  value: number,
  bounds: NumberFieldBounds,
  event: FieldEvent,
): FieldStep {
  switch (event.type) {
    case "type":
      return { draft: event.raw, commit: null };
    case "revert":
      return { draft: null, commit: null };
    case "commit": {
      if (draft === null) return { draft: null, commit: null };
      const verdict = readNumberField(draft, bounds);
      const next = verdict.valid ? verdict.value : undefined;
      return {
        draft: null,
        commit: next === undefined || next === value ? null : next,
      };
    }
  }
}

/** The text a held field shows: the typing, or the committed value under it. */
export function fieldText(draft: string | null, value: number): string {
  return draft ?? String(value);
}
