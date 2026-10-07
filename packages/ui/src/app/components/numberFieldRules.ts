// The numeric-field contract: what the operator typed, what it parses to, and
// what is wrong with it.
//
// A `type="number"` input whose React state is a *number* cannot hold an empty
// string, so the moment the operator clears it the change handler reads `""`,
// `Number("")` gives `0`, a `>= 1` guard rejects that, and the field snaps to a
// floor value under the caret. Replacing a value then means selecting it,
// typing past it, or driving the spinner — which is exactly the behaviour the
// docs now forbid (`components/ui/overview` → "Numeric fields": a form's
// numeric input holds what the operator typed, including nothing at all).
//
// So the state a numeric field is controlled by is the *text*, and a number is
// something read back out of that text. `readNumberField` is the single reader:
// it is the one place that decides whether a piece of typing names a usable
// value, and it returns the reason when it does not so the field can show it and
// the form can refuse to submit on it.
//
// This module is deliberately free of JSX, styling and anything app-shaped: the
// Lattice designer (`apps/lattice-designer`) aliases straight to it, the same way
// it already aliases the console's Lattice player, so the tool shares the rules
// without depending on the console package. `NumberField.tsx` beside this file is
// the themed control built on top of it.

import { useCallback, useState } from "react";

/** Why a piece of typing does not name a usable value. */
export type NumberFieldProblem =
  | "empty"
  | "not-a-number"
  | "not-an-integer"
  | "below-min"
  | "above-max";

/** What a field will accept, and what to call it when it does not. */
export interface NumberFieldBounds {
  /** The smallest value accepted, inclusive. */
  min?: number;
  /** The largest value accepted, inclusive. */
  max?: number;
  /** Reject a fractional entry. */
  integer?: boolean;
  /**
   * Treat an empty field as a value of its own — `undefined`, "not set" — rather
   * than as a problem. Use it for a field that stands for a default, never for
   * one the form needs an answer to.
   */
  optional?: boolean;
  /**
   * How the field is named in the sentence a problem produces, e.g. `"Run count"`
   * → "Run count is required." Omitted, the sentence says "This field".
   */
  label?: string;
}

/** A reading of one field's text. */
export interface NumberFieldVerdict {
  /** The text exactly as the operator typed it. */
  raw: string;
  /**
   * The value the text names, or `undefined` when it names none — which includes
   * an empty optional field, where `undefined` is the answer rather than a fault.
   */
  value: number | undefined;
  /** Whether the form may proceed on this field. */
  valid: boolean;
  /** What is wrong, or `null` when nothing is. */
  problem: NumberFieldProblem | null;
  /** One sentence naming what is wrong, or `null` when nothing is. */
  message: string | null;
}

function problemMessage(
  problem: NumberFieldProblem,
  bounds: NumberFieldBounds,
): string {
  const subject = bounds.label ?? "This field";
  switch (problem) {
    case "empty":
      return `${subject} is required.`;
    case "not-a-number":
      return `${subject} must be a number.`;
    case "not-an-integer":
      return `${subject} must be a whole number.`;
    case "below-min":
      return `${subject} must be ${bounds.min} or more.`;
    case "above-max":
      return `${subject} must be ${bounds.max} or less.`;
  }
}

/**
 * Read one numeric field's text.
 *
 * Pure, so a form can call it wherever it needs the answer — beside the input to
 * decorate it, and again at the submit gate to refuse on it — without the two
 * disagreeing. The text is the only state; every verdict is derived from it.
 */
export function readNumberField(
  raw: string,
  bounds: NumberFieldBounds = {},
): NumberFieldVerdict {
  const fail = (problem: NumberFieldProblem): NumberFieldVerdict => ({
    raw,
    value: undefined,
    valid: false,
    problem,
    message: problemMessage(problem, bounds),
  });
  const ok = (value: number | undefined): NumberFieldVerdict => ({
    raw,
    value,
    valid: true,
    problem: null,
    message: null,
  });

  // Whitespace is not an entry. `Number("  ")` is 0, which is how a cleared field
  // used to become a zero nobody typed.
  const text = raw.trim();
  if (text === "") return bounds.optional ? ok(undefined) : fail("empty");

  const n = Number(text);
  // Rejects NaN and both infinities, so "abc", "1-2", "-" and "Infinity" are all
  // held as typing rather than turned into a value.
  if (!Number.isFinite(n)) return fail("not-a-number");
  if (bounds.integer && !Number.isInteger(n)) return fail("not-an-integer");
  if (bounds.min !== undefined && n < bounds.min) return fail("below-min");
  if (bounds.max !== undefined && n > bounds.max) return fail("above-max");
  return ok(n);
}

/** A form-owned numeric field: the text, its verdict, and the ways to set it. */
export interface NumberFieldState extends NumberFieldVerdict {
  /** Take a keystroke. The text is stored verbatim, whatever it says. */
  setRaw: (raw: string) => void;
  /** Re-seed the field from a value — a reset control, or a loaded record. */
  set: (value: number | undefined) => void;
  /** The bounds this state was declared with, for spreading onto the control. */
  bounds: NumberFieldBounds;
}

/** The text a value is shown as before anyone has typed over it. */
function seedText(value: number | string | undefined | null): string {
  if (value === undefined || value === null) return "";
  return typeof value === "string" ? value : String(value);
}

/**
 * A numeric field whose text this form owns, for a value the form holds until it
 * is submitted.
 *
 * Declare the bounds once here and the field and the submit gate read the same
 * ones: spread `bounds` onto the control, and refuse the submit on `valid`.
 */
export function useNumberFieldState(
  initial: number | string | undefined,
  bounds: NumberFieldBounds = {},
): NumberFieldState {
  const [raw, setRaw] = useState(() => seedText(initial));
  // Both setters are referentially stable, so an effect that seeds the field from a
  // loaded record can depend on one without re-running every render.
  const set = useCallback(
    (value: number | undefined) => setRaw(seedText(value)),
    [],
  );
  return { ...readNumberField(raw, bounds), setRaw, set, bounds };
}

/** A numeric field layered over a value some other state already holds. */
export interface NumberDraft extends NumberFieldVerdict {
  /**
   * Take a keystroke. The text is kept whatever it says, and the value behind it
   * is committed only when the text names one within bounds — so an edit passing
   * through empty, or through a figure below the floor, changes nothing.
   */
  setRaw: (raw: string) => void;
  /**
   * Abandon an in-progress edit so the field shows the committed value again.
   * Wire it to `onBlur`, which is what normalises "007" back to "7" and restores
   * the value under a field the operator cleared and then walked away from.
   */
  release: () => void;
  /** The bounds this draft was declared with, for spreading onto the control. */
  bounds: NumberFieldBounds;
}

/**
 * A numeric field over a live value — one held in a typed record, or applied to a
 * model the moment it changes, where there is no submit to hold the text until.
 *
 * The draft is the operator's typing; `source` is the truth. While an edit is in
 * progress the field shows the typing, and the instant that typing names a value
 * in bounds it is committed. Typing that names nothing usable commits nothing at
 * all, which is what keeps a half-typed grid size from resizing the design under
 * the operator.
 *
 * The draft is tied to the value it was committed against, so a `source` that
 * moves for any other reason — a preset pressed, a different entity selected —
 * takes the field with it rather than leaving stale typing on screen.
 */
export function useNumberDraft(
  source: number | undefined,
  bounds: NumberFieldBounds,
  onCommit: (value: number) => void,
  /**
   * Required on an `optional` field, where clearing the text is an answer — "no
   * value" — rather than typing on the way to one, and has to reach the record.
   */
  onClear?: () => void,
): NumberDraft {
  const [draft, setDraft] = useState<{
    raw: string;
    /** What this text committed, or the standing value when it committed nothing. */
    after: number | undefined;
  } | null>(null);
  // The `source` this hook last saw, so a change of it can be told from a render
  // that merely happened. Kept in state and reconciled during render (React's
  // documented way to derive from a changing prop) rather than in an effect, so the
  // field never paints one frame of stale typing.
  const [seen, setSeen] = useState(source);

  // Somebody else moved the value — a preset pressed, a different entity selected,
  // a reset control — and the edit in progress is no longer about the value on
  // screen, so it goes. A `source` that merely caught up with what this field just
  // committed is our own echo and leaves the typing alone, and a `source` that did
  // not move at all leaves it alone too: a parent that has not echoed the commit
  // back, or that declined it, must not yank the text out from under the caret.
  const moved = !Object.is(seen, source);
  const stale = moved && draft !== null && !Object.is(draft.after, source);
  if (moved) {
    setSeen(source);
    if (stale) setDraft(null);
  }

  const live = stale ? null : draft;
  const text = live === null ? seedText(source) : live.raw;

  return {
    ...readNumberField(text, bounds),
    setRaw: (next) => {
      const verdict = readNumberField(next, bounds);
      setDraft({ raw: next, after: verdict.valid ? verdict.value : source });
      if (verdict.value !== undefined) onCommit(verdict.value);
      else if (verdict.valid) onClear?.();
    },
    release: () => setDraft(null),
    bounds,
  };
}
