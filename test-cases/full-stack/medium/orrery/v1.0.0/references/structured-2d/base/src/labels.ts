// Orrery — the identifier each arm and wheel carries (specs/editor.md "The
// tape panel").
//
// "Each row's label carries an identifier unique among the machine's rows, and
// the same identifier is drawn on that part on the field." One rule, in one
// place, so the letter beside a tape and the letter on the arm can never
// disagree: rows are lettered `A`, `B`, `C`, ... in placement order, and past
// `Z` the letters double up.

import { tapeRows } from "./machine";
import type { PartState } from "./types";

/** The letter for row `index`, counted from `0`: `A`..`Z`, then `AA`, `AB`. */
export function rowLabel(index: number): string {
  if (index < 0) return "";
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let label = "";
  let left = index;
  do {
    label = letters[left % letters.length] + label;
    left = Math.floor(left / letters.length) - 1;
  } while (left >= 0);
  return label;
}

/** Every arm and wheel's identifier, by part `id`, in placement order. */
export function rowLabels(parts: readonly PartState[]): Map<number, string> {
  const labels = new Map<number, string>();
  tapeRows(parts).forEach((part, index) => {
    labels.set(part.id, rowLabel(index));
  });
  return labels;
}
