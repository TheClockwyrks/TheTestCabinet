// instrumentation/overlay — shared readings of the debug overlay.
//
// specs/instrumentation.md (Diagnostics): the overlay "shows the values the
// game registers with it as diagnostic sources", "the backtick key
// (`KeyboardEvent.code` `Backquote`) shows and hides it", and the runtime layer
// the build writes draws it over the game's own frame. The one honest way to
// read it is the same way a person does — off what the frame DRAWS — so these
// helpers read the text a frame paints and compare frames with and without the
// panel. Nothing here fixes where the panel sits or how a line is worded,
// because the specification does not.

import { drawnTextLines } from "../case-harness/text";
import { OVERLAY_TOGGLE_CODE } from "../constants";
import { drawnText, tap, type Harness } from "../harness";

/**
 * Every string the next frame draws, in draw order, followed by each logical
 * run those strings spell that no single call did.
 *
 * The panel is the build's own drawing, so a build that letter-spaces its text
 * draws one glyph per call, and only the coalesced run (`case-harness/text.ts`)
 * carries the token a line reports. The raw strings stay in the corpus because
 * {@link hasToken} is bounded — a run that fuses a figure with the label
 * beside it could hide a token the raw call still shows — so between them a
 * line is found by whichever split it was drawn in. A frame that spelled no
 * run across calls reads exactly as it did before.
 */
export async function frameText(h: Harness): Promise<string[]> {
  const { calls } = await h.frameDraw();
  const raw = drawnText(calls);
  const seen = new Set(raw);
  return [...raw, ...drawnTextLines(calls).filter((run) => !seen.has(run))];
}

/** Press the toggle once — one real key edge, one tick. */
export async function pressToggle(h: Harness): Promise<void> {
  await tap(h, OVERLAY_TOGGLE_CODE);
}

/**
 * The multiset difference `a` minus `b`: every string of `a` that `b` does not
 * account for, occurrence by occurrence. Reading the overlay as the difference
 * between a frame with the panel and one without it keeps the game's own text
 * — the HUD, a menu — out of the corpus, even where the two show one value.
 */
export function minusLines(
  a: readonly string[],
  b: readonly string[],
): string[] {
  const counts = new Map<string, number>();
  for (const line of b) counts.set(line, (counts.get(line) ?? 0) + 1);
  const extra: string[] = [];
  for (const line of a) {
    const held = counts.get(line) ?? 0;
    if (held > 0) counts.set(line, held - 1);
    else extra.push(line);
  }
  return extra;
}

/**
 * The lines two frames agree on — what a stretch of the panel reports STABLY,
 * with anything that changes frame to frame (a countdown, a metric) dropped.
 */
export function stableLines(
  a: readonly string[],
  b: readonly string[],
): string[] {
  const counts = new Map<string, number>();
  for (const line of b) counts.set(line, (counts.get(line) ?? 0) + 1);
  const stable: string[] = [];
  for (const line of a) {
    const held = counts.get(line) ?? 0;
    if (held > 0) {
      counts.set(line, held - 1);
      stable.push(line);
    }
  }
  return stable;
}

/**
 * Whether `value` appears in `lines` as its own token — digit runs match whole
 * ("48" is found in "48 deg" and not in "348"), words match case-insensitively.
 */
export function hasToken(lines: readonly string[], value: string): boolean {
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`(?<![\\w])${escaped}(?![\\w])`, "i");
  return lines.some((line) => pattern.test(line));
}
