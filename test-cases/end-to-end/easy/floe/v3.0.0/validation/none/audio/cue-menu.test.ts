// Floe — audio/cue-menu: a move of the title menu's highlight sounds, once per
// move however long the key is held.
//
// Cue NAMES are not observable outside an engineless build; see audio/cue-hop for
// the doctrine every check here rests on. Neither is "exactly once" countable
// directly — one cue may lawfully be several sources — so what stands in for it
// is a COMPARISON between two moves the game itself made: one tap, and one key
// held down for a second. `specs/ui.md` gives the menu cue to a menu's highlight
// moving, "once per move", and `specs/controls.md` reads the movement actions as
// press edges on every screen but `playing`, "so one press moves the highlight
// one item". A held key is therefore ONE move, and a build that sounds once per
// move sounds the same amount for it as for the tap; a build that re-blips while
// the key is down sounds many times more.
//
// THE SOUND ALONE IS THIS POINT. Where the highlight lands is `controls/menu-up`
// and `controls/menu-down`; the two moves are read back here only to prove the
// game really moved once each time, so a silent stretch is silence about a move
// that happened rather than about a move that never did.
//
// THE TITLE SCREEN CARRIES NOTHING ELSE THAT SOUNDS. `reset` opens it with the
// highlight at `0` (`specs/instrumentation.md`), no crossing is running, and the
// key pressed is bound to the menu alone, so every sound below is the menu's.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { BINDINGS, TITLE_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  ticksFor,
  watchCues,
  type Harness,
} from "../harness";

/** The key a menu's highlight is moved down by (`specs/controls.md`). */
const MENU_DOWN = BINDINGS.down[0];

/** A quarter second of untouched title screen, proving it is quiet on its own. */
const QUIET_TICKS = ticksFor(0.25);

/**
 * How long the key is held for the second move, in whole ticks.
 *
 * A whole second. `specs/hopping.md` fixes `HOP_COOLDOWN` (`0.12` s) as the
 * fastest a HELD key repeats anything in this game, so a build that repeated the
 * title menu's highlight while the key was down would have moved — and sounded —
 * eight times over inside it.
 */
const HOLD_TICKS = ticksFor(1);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("sounds on each move of the highlight, and no more for a key held down", async () => {
  // The title screen as a fresh load opens it: highlight at 0, nothing running.
  await h.debug.reset();
  await h.armAudio();

  const played = watchCues(h);

  const beforeQuiet = played.length;
  await h.advance(QUIET_TICKS);
  const quiet = played.length - beforeQuiet;
  const opening = await h.snapshot();

  // One press: one move.
  const beforeTap = played.length;
  await h.tap(MENU_DOWN);
  const tapped = played.length - beforeTap;
  const afterTap = await h.snapshot();

  const beforeGap = played.length;
  await h.advance(QUIET_TICKS);
  const gap = played.length - beforeGap;

  // The same key held for a second: still one move (specs/controls.md).
  const beforeHold = played.length;
  await h.holdFor(MENU_DOWN, HOLD_TICKS);
  const held = played.length - beforeHold;
  const afterHold = await h.snapshot();

  await captureStill(h, "menu");

  assertEqual(opening.screen, "title", "the game is on the title screen");
  assertEqual(opening.menuIndex, 0, "the highlight opens on the first item");
  assertEqual(quiet, 0, "no sound on the untouched title screen");

  // Each stretch really moved the highlight exactly one item, wrapping over
  // `TITLE_ITEMS` as specs/ui.md fixes.
  assertEqual(
    afterTap.menuIndex,
    1 % TITLE_ITEMS.length,
    "the press moved the highlight one item",
  );
  assertGreaterThan(tapped, 0, "a sound on the move the press made");

  assertEqual(gap, 0, "no sound between the two moves");

  assertEqual(
    afterHold.menuIndex,
    2 % TITLE_ITEMS.length,
    "the held key moved the highlight one further item",
  );
  assertEqual(
    held,
    tapped,
    `the held key sounds exactly what one move sounds ` +
      `(${tapped} sound(s) on the single press)`,
  );
});
