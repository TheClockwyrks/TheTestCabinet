// screens/reading — the one fact about a frame's copy this case reads that the
// shared harness does not: WHICH RUN a piece of copy starts in.
//
// Copy itself is read with the harness's own `drewText`/`drewTextAnywhere`
// (`case-harness/text.ts`), and never here. What a handful of these suites also
// decide is ORDER — `SITES` before `HOW TO PLAY`, `REPLAY` before `SITE SELECT`
// — and PLACEMENT — the row a site's name anchors — and both come down to the
// index of the run a match begins in, which no package reader answers.
//
// THE MATCH IS THE PACKAGE'S. The runs are `drawnTextRuns`' logical runs in the
// reading order it hands them over in, joined with the whitespace folded out and
// compared ignoring case — exactly the fold `drewTextAnywhere` matches under, so
// a `null` here and a `false` there are one answer, and a run this finds is one
// that reading found too.

import type { TextDraw } from "../case-harness/text";

/** `text` with every run of whitespace removed, lowercased. */
function folded(text: string): string {
  return text.replace(/\s+/g, "").toLowerCase();
}

/**
 * The index of the run `wanted` starts in among `runs`, or `null` when the
 * frame did not spell it.
 *
 * `runs` are joined in the order given with every space removed, so copy split
 * across runs, letter-spaced, or padded matches the same as copy drawn in one
 * call; the answer is the run the match begins in, which is what puts two pieces
 * of copy in order and what anchors a piece of copy to where it was drawn.
 */
export function runStarting(
  runs: readonly TextDraw[],
  wanted: string,
): number | null {
  const needle = folded(wanted);
  let joined = "";
  const owner: number[] = [];
  runs.forEach((run, index) => {
    const bare = folded(run.text);
    joined += bare;
    for (let k = 0; k < bare.length; k += 1) owner.push(index);
  });
  const found = joined.indexOf(needle);
  return found < 0 ? null : owner[found]!;
}
