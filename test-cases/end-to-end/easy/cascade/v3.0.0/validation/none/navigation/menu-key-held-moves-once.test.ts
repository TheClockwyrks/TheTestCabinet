// navigation/menu-key-held-moves-once — a held key moves the selection one step
// and no further.
//
// THE RULE. `specs/controls.md`, Menu navigation, Keyboard: "Holding a key moves
// the selection one step rather than repeating it."
//
// WHY IT IS GRADED. It is the one keyboard rule no single press can reach. Every
// other `navigation/` point taps a key — down, one frame, up — and a build that
// re-reads the held key every frame passes all of them while running a player's
// selection round the menu for as long as a finger stays on the key.
//
// THE READING IS TAKEN TWICE UNDER ONE HOLD, and that is what makes it exact. The
// first is the frame the press edge arrived on, where the selection must have
// moved one step; the second is HOLD_FRAMES frames later with the key still down,
// where it must not have moved again. A build repeating on any cadence, however
// long its delay before the first repeat, fails the second reading — a check
// that read the selection once at the end would instead pass or fail by
// arithmetic, since a menu of three items returns to where it started every third
// repeat.
//
// THE HUD IS THE MENU, because it carries three items: a repeat on a two-item
// menu would land back on the right answer every other frame.
//
// ONE CODE OF THE PAIR IS ENOUGH. `navigation/hud-menu-down` is the point that
// grades that both `ArrowDown` and `KeyS` raise the action at all; what this one
// is about is how a build reads a key that stays down, which is the same reading
// whichever code raised it.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { MENU_DOWN_KEYS } from "../constants";
import {
  captureStill,
  createHarness,
  openTable,
  type Harness,
} from "../harness";

/** Where the selection starts, and the one step the hold may move it. */
const FROM = 0;
const TO = 1;

/** The code held down. */
const CODE = MENU_DOWN_KEYS[0];

/**
 * How long the key is held after the frame that delivered its press edge, in
 * frames.
 *
 * A second of game time at the sixty-hertz tick `specs/overview.md` fixes, which
 * is longer than any delay a build could reasonably wait before repeating and
 * long enough that a build repeating every frame has gone round a three-item menu
 * twenty times.
 */
const HOLD_FRAMES = 60;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("moves the HUD selection one step while the key stays down", async () => {
  await openTable(h);
  await h.debug.setMenuIndex(FROM);
  assertEqual(
    (await h.snapshot()).menuIndex,
    FROM,
    `posing: menuIndex before the key goes down — a selection that was never ` +
      `posed leaves this point nothing to move`,
  );

  await h.hold(CODE);
  await h.advance(1);
  const onTheEdge = await h.snapshot();

  await h.advance(HOLD_FRAMES);
  const stillHeld = await h.snapshot();
  await h.release(CODE);

  await h.advance(1);
  // Before the assertions, so a menu that ran on under the hold still leaves the
  // picture of where it ended up.
  await captureStill(h, "hud");

  assertEqual(
    onTheEdge.menuIndex,
    TO,
    `menuIndex on the frame ${CODE} went down, from ${String(FROM)} — the ` +
      `press edge moves the selection down one (specs/controls.md)`,
  );
  assertEqual(
    stillHeld.menuIndex,
    TO,
    `menuIndex after ${String(HOLD_FRAMES)} further frames with ${CODE} ` +
      `still down — holding a key moves the selection one step rather than ` +
      `repeating it (specs/controls.md)`,
  );
});
