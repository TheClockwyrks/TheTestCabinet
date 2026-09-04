// Deepcore — the mouse, for the checks that are about the mouse. CASE-PROVIDED.
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
//      `textDraws`, which carries whatever transform the build drew under, and
//      the run whose text matches is the control. A text anchor is a point ON the
//      control rather than its centre — `textAlign` and `textBaseline` are the
//      build's — so a small ring of offsets around it is tried until the control
//      answers.
//   2. BY SWEEPING THE BAND IT MUST BE IN. The status bar's three controls carry
//      no fixed copy, and the only thing the specification fixes about them is
//      that they are ON the status bar, `y` in `[0, HUD_H]`. So the band is swept
//      until one of them answers. The sweep searches the SCREEN for a control the
//      specification requires to be somewhere on it, which is what "operable with
//      the mouse" means when no layout is fixed; it never searches the game's
//      world for a scenario to stand in.
//
// A CLICK IS NOT A FRAME. The page's own loop is what drains a DOM event into the
// game — the same reason `browserHold` yields two animation frames — and the game
// is off its clock, so nothing here advances the simulation on the browser's own
// frames. One driven frame follows, which is what makes the press visible to a
// build that reads its pointer at the top of an update.

import { HUD_H, STAGE_W } from "../constants";
import { textDraws, type Harness, type TextDraw } from "../harness";

/** Offsets around a text anchor, nearest first, tried until the control answers. */
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

/** Let the page's own loop drain the event, then run one driven frame. */
async function settle(h: Harness): Promise<void> {
  await h.page.evaluate(
    () =>
      new Promise<void>((done) => {
        requestAnimationFrame(() => requestAnimationFrame(() => done()));
      }),
  );
  await h.advance(1);
}

/** Click a logical stage point with the real mouse, and let the page see it. */
export async function clickStage(
  h: Harness,
  x: number,
  y: number,
): Promise<void> {
  const { dpr } = await h.surface();
  const at = h.device(x, y);
  const scale = dpr > 0 ? dpr : 1;
  await h.page.mouse.click(at.x / scale, at.y / scale);
  await settle(h);
}

/** Every run of text the next frame draws, with its anchor in stage units. */
export async function frameText(h: Harness): Promise<TextDraw[]> {
  return textDraws(await h.frameCalls());
}

/** The first run of text the next frame draws whose content matches. */
export async function findText(
  h: Harness,
  pattern: RegExp,
): Promise<TextDraw | null> {
  return (await frameText(h)).find((run) => pattern.test(run.text)) ?? null;
}

/**
 * Click around a point until `took` reports the control answered.
 *
 * The ring exists because a text anchor is a point on the control rather than its
 * middle: `textAlign` decides which end of the run it names and `textBaseline`
 * where in the line height it sits, and both are the build's.
 */
export async function clickNear(
  h: Harness,
  point: { x: number; y: number },
  took: () => Promise<boolean>,
): Promise<boolean> {
  for (const [dx, dy] of NEAR_OFFSETS) {
    await clickStage(h, point.x + dx, point.y + dy);
    if (await took()) return true;
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
  took: () => Promise<boolean>,
  between?: () => Promise<void>,
): Promise<boolean> {
  for (const y of SWEEP_ROWS) {
    for (let x = SWEEP_STEP / 2; x < STAGE_W; x += SWEEP_STEP) {
      if (between !== undefined) await between();
      await clickStage(h, x, y);
      if (await took()) return true;
    }
  }
  return false;
}
