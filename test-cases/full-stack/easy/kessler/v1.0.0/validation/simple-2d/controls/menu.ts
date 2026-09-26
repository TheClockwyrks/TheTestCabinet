// Kessler — one key pressed on the freshly opened title menu. CASE-PROVIDED.
//
// The six title-menu points differ in exactly two things: the key pressed and
// what the press must leave behind. Everything around them — how the title is
// opened, where the highlight starts, how a lower entry is reached, and where
// the evidence is captured — is one arrangement, written once here so the six
// suites cannot drift apart into slightly different questions.
//
// WHY THE TITLE, AND WHY A RESET OPENS IT. specs/screens.md gives `title` a
// two-entry menu (`START`, `HOW TO PLAY`), opens the game on it, and fixes
// that "entering a menu-bearing screen highlights entry `0`" — so a plain
// reset is the direct route to a known menu, through the surface alone,
// touching no other screen on the way.
//
// WHY A LOWER ENTRY IS REACHED WITH ONE ArrowDown. The surface carries no
// operation for the highlight — `menu.index` is a reading, moved only by
// entering a screen and by the `up`/`down` actions themselves — so the one
// route to a lower entry is a real `down` press, made here with its primary
// key. A build whose `down` is broken cannot pose that precondition and the
// point falls with it: a validator that cannot pose the world it needs fails
// the item it decides.

import { assertEqual } from "../assert";
import { KEYS } from "../constants";
import {
  captureReplay,
  captureStill,
  tap,
  type Harness,
  type KesslerSnapshot,
} from "../harness";

/** What one title-menu press left behind. */
export interface TitlePress {
  /** The title as the reset opened it: entry `0` highlighted. */
  opened: KesslerSnapshot;
  /** The menu as the key under test found it. */
  posed: KesslerSnapshot;
  /** The game after the one press. */
  after: KesslerSnapshot;
}

/**
 * Open the title, put the highlight on entry `fromIndex`, press `key` once,
 * and keep the frame after the press as the still `outputId`.
 */
export async function moveHighlight(
  h: Harness,
  key: string,
  fromIndex: 0 | 1,
  outputId: string,
): Promise<TitlePress> {
  h.reset();
  const opened = h.snapshot();
  assertEqual(opened.screen, "title", "the screen a reset opens");
  assertEqual(opened.menu.index, 0, "the highlight on a freshly opened title");
  if (fromIndex === 1) await tap(h, KEYS.down[0]);
  const posed = h.snapshot();
  assertEqual(
    posed.menu.index,
    fromIndex,
    "the entry the key under test is pressed on",
  );
  await tap(h, key);
  captureStill(h, outputId);
  return { opened, posed, after: h.snapshot() };
}

/**
 * Open the title with the highlight resting on START and press `key` once,
 * keeping the press and the first moments after it as the replay `outputId`.
 */
export async function confirmStart(
  h: Harness,
  key: string,
  outputId: string,
): Promise<TitlePress> {
  h.reset();
  const opened = h.snapshot();
  assertEqual(opened.screen, "title", "the screen a reset opens");
  assertEqual(
    opened.menu.index,
    0,
    "the highlighted entry (START) the press accepts",
  );
  const after = await captureReplay(h, outputId, async () => {
    await tap(h, key);
    return await h.tick(10);
  });
  return { opened, posed: opened, after };
}
