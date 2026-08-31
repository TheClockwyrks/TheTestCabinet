// Kessler — one pause key pressed over a live session. CASE-PROVIDED.
//
// The two pause points differ only in the key pressed: specs/controls.md binds
// `back` to `Escape` and `pause` to `KeyP`, both live on `playing`, and
// specs/screens.md has both set `screen` to `paused`. The arrangement around
// the press is written once here so the two suites ask the same question of
// two keys.
//
// THE WORLD IS AN EMPTY PLAYING FIELD. The point is the key, not the
// simulation, so the session is isolated — no targets, no balls, no pods,
// both driver switches off — and reached through the surface alone. A build
// with a broken menu and a working pause key must pass here, so no menu is
// touched on the way in.

import { assertEqual } from "../assert";
import {
  captureReplay,
  isolate,
  tap,
  type Harness,
  type KesslerSnapshot,
} from "../harness";

/** What one pause press left: the playing field, and the game after. */
export interface PausePress {
  posed: KesslerSnapshot;
  after: KesslerSnapshot;
}

/**
 * Enter an isolated playing session, press `key` once, and keep the press and
 * the still moments after it as the replay `outputId`.
 */
export async function pauseWith(
  h: Harness,
  key: string,
  outputId: string,
): Promise<PausePress> {
  const posed = isolate(h);
  assertEqual(posed.screen, "playing", "the screen the key is pressed on");
  const after = await captureReplay(h, outputId, async () => {
    await tap(h, key);
    return await h.tick(5);
  });
  return { posed, after };
}
