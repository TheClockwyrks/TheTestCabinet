// The snapshot schedule as text, and when that text reaches the timeline.
//
// The field used to be controlled by the parsed list rather than by the typing:
// `value={snapshots.join(", ")}` with a parse on every keystroke. A comma typed to
// start a second checkpoint parsed to a one-entry list, which re-rendered the field
// without the comma — so a second snapshot could not be typed at all — and a
// schedule cleared to retype it was gone with the first backspace, in a tool with no
// undo. Since a scored scenario is graded at exactly these ticks, that is the
// load-bearing field of the toolbar.
//
// So the text is the state while the field is being edited, and the list is
// something read out of it when the edit is finished with (blur, or Enter), exactly
// as the held numeric fields work.

/** The schedule as the field shows it when nobody is typing into it. */
export function formatTicks(ticks: readonly number[]): string {
  return ticks.join(", ");
}

/**
 * A comma-separated tick list as numbers, keeping whatever the field says —
 * including a list that is out of order or past the end. Validation belongs to
 * `timelineError`, which reports it and blocks the save; silently repairing the text
 * as it is typed would fight the person editing it.
 */
export function parseTicks(text: string): number[] {
  return text
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((part) => Math.floor(Number(part)))
    .filter((n) => Number.isFinite(n));
}

/**
 * The schedule a finished edit leaves, or `null` when it leaves the current one
 * alone.
 *
 * An emptied field is an abandoned edit rather than a request for no schedule at
 * all: the engine refuses an empty one, and the schedule it would drop is not
 * recoverable. Typing that names the schedule already held commits nothing, so
 * tabbing through the field does not mark the file dirty.
 */
export function commitTickList(
  draft: string | null,
  current: readonly number[],
): number[] | null {
  if (draft === null) return null;
  const next = parseTicks(draft);
  if (next.length === 0) return null;
  return sameTicks(next, current) ? null : next;
}

/** Whether two schedules are the same list of ticks in the same order. */
export function sameTicks(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((t, i) => t === b[i]);
}
