// visibility/legible — the shared reading behind every "this screen's text is
// legible" point.
//
// `specs/screens.md`: "Kessler fixes no palette, no font, and no layout for its
// screens. Every piece of text a screen shows is legible against whatever sits
// behind it at the logical stage size of `1000 x 1000`." So the copy, the font,
// and the placement are the build's; what is read is that each run of text the
// frame drew CONTRASTS where it was drawn, against the category's figure for
// clearly apart (`DISTINCT_MIN`, see `visibility/distinct.ts`).
//
// HOW A RUN IS FOUND, AND READ. The frame's own draw operations name every text
// run and the anchor it landed at (`textDraws`), so the runs read are exactly
// the pieces of text the screen shows — the fixed copy and the build's own alike
// — with no guess at either. Around each anchor a patch of samples is read, and
// the patch's CONTRAST (its two widest-apart colors) must clear the figure: a
// legible run's glyphs stand apart from the ground they sit on inside that
// patch, while text painted into a like-colored ground shows a flat patch. A
// screen that draws no text at all fails: every screen this is used on has text
// the specification requires it to show, so a frame with no readable run is a
// frame hiding the thing under test.
//
// THE OVERLAY SCREENS. `paused` and `waveclear` draw OVER the field, and a build
// may quiet what lies underneath — the way `specs/screens.md` lets the title
// show its field "dimmed or otherwise quieted". A quieted HUD under the overlay
// is that background, not the overlay's own text, so on those two screens the
// runs read are the ones the screen ADDS: the runs of its frame that the plain
// `playing` frame of the same posed session did not draw at the same place.

import { assertGreaterThan } from "../assert";
import { STAGE_H, STAGE_W, type Screen } from "../constants";
import {
  captureStill,
  samplePoints,
  textDraws,
  type Harness,
} from "../harness";
import { clampPt, contrast, DISTINCT_MIN, patchAround } from "./distinct";

/** A posed score with a digit in every place, so a readout is real text. */
export const POSED_SCORE = 12345;

/** Runs drawn this far off the stage are not shown, and are not read. */
const OFF_STAGE = 40;

/** One run of text, as the frame's own operations name it. */
export interface Run {
  text: string;
  x: number;
  y: number;
}

/** One run's identity: its text at its anchor, coarse enough to dedupe. */
export function runKey(run: Run): string {
  return `${run.text}@${Math.round(run.x / 4)},${Math.round(run.y / 4)}`;
}

/** The distinct on-stage runs of one rendered frame. */
export async function screenRuns(h: Harness): Promise<Run[]> {
  const calls = await h.frameCalls();
  const seen = new Set<string>();
  return textDraws(calls).filter((run) => {
    if (run.text.trim() === "") return false;
    if (run.x < -OFF_STAGE || run.x > STAGE_W + OFF_STAGE) return false;
    if (run.y < -OFF_STAGE || run.y > STAGE_H + OFF_STAGE) return false;
    const key = runKey(run);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Keep the frame's picture and read every listed run's patch contrast. */
export async function assertRunsLegible(
  h: Harness,
  screen: Screen,
  still: string,
  runs: readonly Run[],
): Promise<void> {
  await captureStill(h, still);

  assertGreaterThan(
    runs.length,
    0,
    `the runs of text the ${screen} screen drew`,
  );

  for (const run of runs) {
    const patch = await samplePoints(
      h,
      patchAround(clampPt({ x: run.x, y: run.y })),
    );
    assertGreaterThan(
      contrast(patch),
      DISTINCT_MIN,
      `the contrast of the ${screen} screen's "${run.text}" against what ` +
        `sits behind it at (${Math.round(run.x)}, ${Math.round(run.y)})`,
    );
  }
}

/**
 * Read an overlay screen: the runs its frame adds over the `playing` frame
 * beneath it. `enter` is the caller's own pose of the overlay.
 */
export async function assertOverlayTextLegible(
  h: Harness,
  screen: Screen,
  still: string,
  enter: () => unknown,
): Promise<void> {
  const underneath = new Set((await screenRuns(h)).map(runKey));
  await enter();
  const added = (await screenRuns(h)).filter(
    (run) => !underneath.has(runKey(run)),
  );
  await assertRunsLegible(h, screen, still, added);
}
