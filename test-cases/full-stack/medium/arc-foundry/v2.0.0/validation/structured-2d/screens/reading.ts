// screens/reading — what a screens check reads off a rendered frame.
//
// CASE-PROVIDED, and not a suite: vitest collects `*.test.ts` alone, so this file
// is a module the checks next door import and never a point in its own right.
//
// WHY IT LIVES HERE RATHER THAN IN THE HARNESS. The harness owns every compound
// sequence that POSES the game — opening a run, standing a structure, releasing a
// unit — because those are shared by every category, and it owns the colour
// samplers for the same reason. What this file holds is the one reading only the
// screens checks take: the text a frame drew, folded so that a heading a build
// letter-spaced still reads as the words a player sees.
//
// WHAT A TEXT READING IS FAIR TO ASSERT. `specs/ui.md` fixes each screen's COPY
// and its navigation and explicitly leaves its layout, palette and type to the
// build: "Arc Foundry fixes no palette, no font, no menu layout, and no artwork."
// So a check reads the runs of text a frame drew and asks whether the words the
// specification names are among them — by substring and ignoring case, because a
// menu entry is commonly drawn with a marker beside it and a heading is commonly
// padded. Where the entry was drawn, in what colour, at what size, is the
// build's.
//
// UNDER THIS ENGINE the runs come off the draw-command recorder the harness wraps
// the 2D context in, and that is the whole of the reading whichever way the build
// drew them: a `TextComponent` the engine's pipeline lays down and a run a
// `DrawComponent` writes straight to `api.ctx` both reach the context as
// `fillText` or `strokeText`, so every run a frame issued is on that list, in the
// order the pipeline and the draws put it there.

import type { DrawCall } from "../harness";

/** Every run of text a frame drew, filled or stroked, in the order it drew them. */
export function drawnText(calls: readonly DrawCall[]): string[] {
  return calls.flatMap((call) =>
    call.kind === "call" &&
    (call.method === "fillText" || call.method === "strokeText") &&
    typeof call.args[0] === "string"
      ? [call.args[0]]
      : [],
  );
}

/**
 * The whole of a frame's text as one upper-cased string, with letter-spacing
 * folded back into words.
 *
 * WHY THE FOLDING. `specs/ui.md` fixes each screen's copy and leaves its type to
 * the build, and a common way to letter-space a heading on a canvas is to draw
 * each character with its own `fillText` at its own advance. A frame that does
 * that emits the heading as a run of one-character draws, so joining the runs
 * naively turns `ARC FOUNDRY` into `A R C   F O U N D R Y` — which no reading of
 * the copy would find, and which would also scatter a standalone letter across the
 * frame for every heading on the screen, so that a check looking for the key `B`
 * would find one in `BUILD`.
 *
 * So a maximal run of consecutive one-character draws is joined with nothing
 * between, which is the text the player actually reads, and the groups are joined
 * with a space. A build that draws its copy as whole strings is unaffected: every
 * run longer than one character is a group of its own.
 */
export function frameText(calls: readonly DrawCall[]): string {
  const runs = drawnText(calls);
  const groups: string[] = [];
  let spaced: string[] = [];
  const flush = (): void => {
    if (spaced.length > 1) groups.push(spaced.join(""));
    else if (spaced.length === 1) groups.push(spaced[0]!);
    spaced = [];
  };
  for (const run of runs) {
    if ([...run].length === 1) spaced.push(run);
    else {
      flush();
      groups.push(run);
    }
  }
  flush();
  return groups.join(" ").toUpperCase();
}

/**
 * Whether the frame drew `text`, ignoring case and every difference of spacing.
 *
 * Substring rather than equality on purpose: the copy a check asserts is the
 * case's own, but how a build presents it is the build's, and a menu entry is
 * commonly drawn with a selection marker or padding around it. Whitespace is
 * dropped from both sides as well, because a build is free to letter-space a
 * heading, to break a line where it likes, and to draw a phrase as several runs —
 * none of which changes the words on the screen.
 */
export function drewText(calls: readonly DrawCall[], text: string): boolean {
  const squeeze = (value: string): string => value.replace(/\s+/g, "");
  return squeeze(frameText(calls)).includes(squeeze(text.toUpperCase()));
}

/**
 * Whether the frame drew `value` as a number of its own.
 *
 * Bounded on both sides so that a screen showing `40` is not read as showing `4`,
 * and so that the `50` of a wave count is not found inside a `150`. A build is
 * free to pad, group or label the figure; what it may not do is leave it out.
 */
export function drewNumber(calls: readonly DrawCall[], value: number): boolean {
  return new RegExp(`(?<![\\d.])${value}(?![\\d.])`).test(frameText(calls));
}

/** Every number the frame drew, as numbers, in the order they were drawn. */
export function drawnNumbers(calls: readonly DrawCall[]): number[] {
  return (frameText(calls).match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
}

/** The cluster radius a screens sample is averaged over, in logical units. */
export const SAMPLE_SPREAD = 4;
