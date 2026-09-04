// Deepcore — the mouse, for the checks that are about the mouse. CASE-PROVIDED.
//
// Not a `.test.ts`, so vitest never collects it.
//
// `specs/controls.md` requires every menu item, panel control and status-bar
// control to be clickable, and `specs/ui.md` requires every panel and menu to be
// fully operable with the mouse. Nothing in either fixes WHERE any of them is
// drawn: `specs/overview.md` hands the layout to the build. So a check about the
// mouse has to find its target the way a player does — by looking at the screen —
// rather than by knowing a coordinate the specification never stated.
//
// Two ways of finding one, and both are here because the specification supports
// exactly these two:
//
//   1. BY ITS COPY. The screen copy a menu item or a panel control carries IS
//      fixed: `TITLE_ITEMS`, `PAUSE_ITEMS`, `SELL`, `FABRICATE`, `LAUNCH`,
//      `JETTISON`, `USE`. So the frame's own text runs are read back through
//      `textSpans`, which places each run in logical stage units through the
//      transform in force at the call, and the run whose text matches is the
//      control. What `textSpans` gives beyond the anchor is the run's horizontal
//      extent, so the point aimed at is the middle of the glyphs rather than
//      whichever end `textAlign` happened to name; the vertical placement is
//      still `textBaseline`'s, which is the build's, so a small ring of offsets
//      around the point is tried until the control answers.
//   2. BY SWEEPING THE BAND IT MUST BE IN. The status bar's three controls carry
//      no fixed copy, and the only thing the specification fixes about them is
//      that they are ON the status bar, `y` in `[0, HUD_H]`. So the band is swept
//      until one of them answers. The sweep searches the SCREEN for a control the
//      specification requires to be somewhere on it, which is what "operable with
//      the mouse" means when no layout is fixed; it never searches the game's
//      world for a scenario to stand in.
//
// A CLICK IS A FRAME. The engine collects pointer events as they arrive and
// closes the input frame at the end of each one it runs, so a press reaches the
// game on the frame that follows it — which is exactly what `Harness.click` does:
// move, press, release, then run one frame.

import { HUD_H, STAGE_W } from "../../src/constants";
import { textSpans, type Harness, type TextSpan } from "../harness";

/** Offsets around the middle of a run of text, nearest first. */
const NEAR_OFFSETS: readonly (readonly [number, number])[] = [
  [0, -7],
  [8, -7],
  [-8, -7],
  [0, 0],
  [0, -16],
  [20, -7],
  [-20, -7],
  [0, -24],
];

/** How far apart the sweep's columns sit, in logical units. */
const SWEEP_STEP = 16;

/** The rows of the status bar the sweep clicks along. */
const SWEEP_ROWS: readonly number[] = [HUD_H / 2, HUD_H / 4, (HUD_H * 3) / 4];

/** Click a logical stage point, and run the frame that delivers it. */
export function clickStage(h: Harness, x: number, y: number): Promise<void> {
  return h.click(x, y);
}

/** Every run of text the next frame draws, placed in logical stage units. */
export async function frameText(h: Harness): Promise<TextSpan[]> {
  return textSpans(h, await h.frameCalls());
}

/** The first run of text the next frame draws whose content matches. */
export async function findText(
  h: Harness,
  pattern: RegExp,
): Promise<TextSpan | null> {
  return (await frameText(h)).find((run) => pattern.test(run.text)) ?? null;
}

/** The middle of a run's glyphs, which is the point on the control to aim at. */
export function midpointOf(run: TextSpan): { x: number; y: number } {
  return { x: (run.left + run.right) / 2, y: run.y };
}

/**
 * Click around a run of text until `took` reports the control answered.
 *
 * The ring exists because a run of text names a point on the control rather than
 * its middle: `textBaseline` decides where in the line height the anchor sits,
 * and that is the build's.
 */
export async function clickNear(
  h: Harness,
  run: TextSpan,
  took: () => boolean,
): Promise<boolean> {
  const point = midpointOf(run);
  for (const [dx, dy] of NEAR_OFFSETS) {
    await clickStage(h, point.x + dx, point.y + dy);
    if (took()) return true;
  }
  return false;
}

/**
 * Click along the status bar until `took` reports a control answered.
 *
 * `between` runs before each click, so a sweep whose earlier clicks landed on a
 * different control can put the game back where it started.
 */
export async function sweepStatusBar(
  h: Harness,
  took: () => boolean,
  between?: () => void,
): Promise<boolean> {
  for (const y of SWEEP_ROWS) {
    for (let x = SWEEP_STEP / 2; x < STAGE_W; x += SWEEP_STEP) {
      if (between !== undefined) between();
      await clickStage(h, x, y);
      if (took()) return true;
    }
  }
  return false;
}
