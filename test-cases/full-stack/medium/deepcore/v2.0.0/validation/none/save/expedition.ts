// Deepcore — the openings the save, mode and world-size checks share.
// CASE-PROVIDED.
//
// Not a `.test.ts`, so vitest never collects it. Everything here is built from
// the atomic operations `specs/instrumentation.md` fixes, exactly as the shared
// harness's own sequences are; it lives here rather than in `harness.ts` because
// only the three categories that turn on persistence need it.
//
// TWO THINGS ARE WORTH SAYING ABOUT REACHING A SAVE.
//
// The slot outlives the page. `reset()` deliberately leaves it alone, because it
// outlives the session, so a check whose subject is the save clears it itself
// rather than assuming it opened empty.
//
// Restoring is a MENU action and there is no operation for it. specs/ui.md fixes
// `CONTINUE` as the title menu's first item while a save exists, so
// `continueFromTitle` selects index 0 and confirms. That is the one place these
// checks reach the game through a menu, because the specification puts the
// restore behind one; every other route here is a control or a pose.

import { assertEqual } from "../assert";
import { SPAWN_COL } from "../constants";
import {
  ACTION_KEY,
  layCamp,
  openScene,
  standAtCamp,
  type Harness,
  type Mode,
  type WorldSize,
} from "../harness";

/** How an expedition opens: the seed, the size, and the mode it is played in. */
export interface ExpeditionOptions {
  seed?: number;
  size?: WorldSize;
  mode?: Mode;
}

/**
 * Open an expedition standing at the camp with the save slot empty.
 *
 * `openScene` leaves an EMPTY mine, which is open at `row 1` too, so the camp's
 * ground is laid back the way generation leaves it before the miner is stood on
 * it; otherwise the first frame drops it down the shaft. One frame runs so the
 * miner is settled and reads as grounded before anything is asked of it.
 */
export async function openAtCamp(
  h: Harness,
  options: ExpeditionOptions = {},
): Promise<void> {
  await openScene(h, options);
  await h.debug.clearSave();
  await layCamp(h);
  await standAtCamp(h, SPAWN_COL);
  await h.advance(1);
}

/**
 * Open an expedition on a GENERATED mine, standing at the camp, slot empty.
 *
 * The companion to {@link openAtCamp} for a check whose subject is what the save
 * carries of the world: a cleared mine would make "the same shafts already cut"
 * indistinguishable from a fresh one.
 */
export async function openGeneratedAtCamp(
  h: Harness,
  options: ExpeditionOptions = {},
): Promise<void> {
  await openScene(h, options);
  await h.debug.clearSave();
  await h.debug.generateMine();
  await standAtCamp(h, SPAWN_COL);
  await h.advance(1);
}

/**
 * Write the save through the control that stands for activating the Save Pad,
 * and confirm the slot took it.
 *
 * The confirmation is the arrangement's, not the verdict's: a check that goes on
 * to read what was restored needs to know a save was written at all, and saying
 * so here names the step that failed instead of leaving a later reading
 * unexplained.
 */
export async function bankSave(h: Harness): Promise<void> {
  await h.debug.save();
  assertEqual(
    (await h.snapshot()).hasSave,
    true,
    "specs/gameplay.md: activating the Save Pad writes the save on the spot",
  );
}

/**
 * Take `CONTINUE` on the title menu, which specs/ui.md fixes as its first item
 * while a save exists.
 */
export async function continueFromTitle(h: Harness): Promise<void> {
  await h.debug.setScreen("title");
  await h.debug.setMenuIndex(0);
  await h.tap(ACTION_KEY.activate);
}

/**
 * The menu the current screen lists, read the way a player reads it: step the
 * highlight down until it wraps, and report what each index was.
 *
 * The snapshot reports `menuIndex` but not the items, and specs/ui.md fixes both
 * the items and that movement wraps at the ends, so the length is where the
 * highlight comes back to `0`. `limit` bounds a build whose highlight never
 * wraps.
 */
export async function menuLength(h: Harness, limit = 12): Promise<number> {
  await h.debug.setMenuIndex(0);
  for (let step = 1; step <= limit; step += 1) {
    await h.tap(ACTION_KEY.down);
    if ((await h.snapshot()).menuIndex === 0) return step;
  }
  return limit + 1;
}
