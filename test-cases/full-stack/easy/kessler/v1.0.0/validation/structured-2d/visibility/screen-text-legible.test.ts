// visibility/screen-text-legible — every run of text a screen draws contrasts
// with what sits behind it.
//
// WHAT THE SPECIFICATION FIXES. `specs/screens.md`: "Kessler fixes no
// palette, no font, and no layout for its screens. Every piece of text a
// screen shows is legible against whatever sits behind it at the logical
// stage size of `1000 x 1000`." So the copy, the font, and the placement are
// the build's; what is read, on each of the six screens, is that each run of
// text the frame drew CONTRASTS where it was drawn, against the category's
// figure for clearly apart (`DISTINCT_MIN`, see `visibility/distinct.ts`).
//
// HOW A RUN IS FOUND, AND READ. The frame's own draw operations name every
// text run and the anchor it landed at (`textDraws`), so the runs read are
// exactly the pieces of text the screen shows — the fixed copy and the
// build's own alike — with no guess at either. Around each anchor a patch of
// samples is read, and the patch's CONTRAST (its two widest-apart colors)
// must clear the figure: a legible run's glyphs stand apart from the ground
// they sit on inside that patch, while text painted into a like-colored
// ground shows a flat patch. A screen that draws no text at all fails: every
// screen here has text the specification requires it to show, so a frame
// with no readable run is a frame hiding the thing under test.
//
// THE OVERLAY SCREENS. `paused` and `waveclear` draw OVER the field, and a
// build may quiet what lies underneath — the way `specs/screens.md` lets the
// title show its field "dimmed or otherwise quieted". A quieted HUD under the
// overlay is that background, not the overlay's own text, so on those two
// screens the runs read are the ones the screen ADDS: the runs of its frame
// that the plain `playing` frame of the same posed session did not draw at
// the same place.
//
// THE WORLD EACH SCREEN IS POSED IN. Each screen is entered directly through
// the surface's `setScreen` — never through the menus, which are other
// items' business — over a reset session; `playing` and `waveclear` over an
// isolated field, and the score posed to five digits where a score readout
// shows, so the digits read is a real one.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan } from "../assert";
import {
  captureStill,
  isolate,
  openHarness,
  textDraws,
  type Harness,
} from "../harness";
import type { Screen } from "../harness";
import {
  clampPt,
  contrast,
  DISTINCT_MIN,
  patchAround,
  samplePoints,
} from "./distinct";

/** A posed score with a digit in every place, so the readout is real text. */
const POSED_SCORE = 12345;

/** Runs drawn this far off the stage are not shown, and are not read. */
const OFF_STAGE = 40;

/** One run's identity: its text at its anchor, coarse enough to dedupe. */
function runKey(run: { text: string; x: number; y: number }): string {
  return `${run.text}@${Math.round(run.x / 4)},${Math.round(run.y / 4)}`;
}

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(() => {
  h?.dispose();
});

/** The distinct on-stage runs of one rendered frame. */
async function screenRuns(): Promise<{ text: string; x: number; y: number }[]> {
  const calls = await h.frameCalls();
  const seen = new Set<string>();
  return textDraws(calls).filter((run) => {
    if (run.text.trim() === "") return false;
    if (run.x < -OFF_STAGE || run.x > 1000 + OFF_STAGE) return false;
    if (run.y < -OFF_STAGE || run.y > 1000 + OFF_STAGE) return false;
    const key = runKey(run);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Keep the frame's picture and read every listed run's patch contrast. */
function assertRunsLegible(
  screen: Screen,
  still: string,
  runs: readonly { text: string; x: number; y: number }[],
): void {
  captureStill(h, still);

  assertGreaterThan(
    runs.length,
    0,
    `the runs of text the ${screen} screen drew`,
  );

  for (const run of runs) {
    const patch = samplePoints(h, patchAround(clampPt({ x: run.x, y: run.y })));
    assertGreaterThan(
      contrast(patch),
      DISTINCT_MIN,
      `the contrast of the ${screen} screen's "${run.text}" against what ` +
        `sits behind it at (${Math.round(run.x)}, ${Math.round(run.y)})`,
    );
  }
}

/** Read an overlay screen: the runs its frame adds over the playing frame. */
async function assertOverlayTextLegible(
  screen: Screen,
  still: string,
): Promise<void> {
  const underneath = new Set((await screenRuns()).map(runKey));
  h.debug.setScreen(screen);
  const added = (await screenRuns()).filter(
    (run) => !underneath.has(runKey(run)),
  );
  assertRunsLegible(screen, still, added);
}

it("draws the title screen's text legibly", async () => {
  h.reset();
  assertRunsLegible("title", "title", await screenRuns());
});

it("draws the howto screen's text legibly", async () => {
  h.reset();
  h.debug.setScreen("howto");
  assertRunsLegible("howto", "howto", await screenRuns());
});

it("draws the playing screen's HUD text legibly", async () => {
  isolate(h);
  h.debug.setScore(POSED_SCORE);
  assertRunsLegible("playing", "playing", await screenRuns());
});

it("draws the waveclear banner's text legibly", async () => {
  isolate(h);
  await assertOverlayTextLegible("waveclear", "waveclear");
});

it("draws the pause menu's text legibly", async () => {
  isolate(h);
  await assertOverlayTextLegible("paused", "paused");
});

it("draws the gameover screen's text legibly", async () => {
  h.reset();
  h.debug.setScore(POSED_SCORE);
  h.debug.setScreen("gameover");
  assertRunsLegible("gameover", "gameover", await screenRuns());
});
