// Floe — audio/cue-menu: a move of the title menu's highlight plays the menu cue,
// exactly once per move however long the key is held.
//
// The cue is read BY NAME off the engine's bus; see audio/cue-hop for the reading
// every check in this directory rests on. "Once per move" is therefore counted
// directly here: the bus announces each play, so a build that re-plays the cue
// while the key is down is counted rather than compared against something else.
//
// THE RULE THIS POINT DECIDES. `specs/ui.md` gives the `menu` cue to "a menu's
// highlight moving, once per move", and `specs/controls.md` reads the movement
// actions as press edges on every screen but `playing`, "so one press moves the
// highlight one item". A key held for a whole second is therefore ONE move, and it
// must play the cue exactly once — the same as the single tap before it.
//
// THE SOUND ALONE IS THIS POINT. Where the highlight LANDS is `controls.menu-up`
// and `controls.menu-down`; the two moves are read back here only to prove the
// game really moved once each time, so a silent stretch is silence about a move
// that happened rather than about a move that never did.
//
// THE TITLE SCREEN CARRIES NOTHING ELSE THAT SOUNDS. `reset` opens it with the
// highlight at `0` (`specs/instrumentation.md`), no crossing is running, and the
// key pressed is bound to the menu alone, so nothing else on this screen can raise
// an event.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { CUES, TITLE_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  holdFor,
  keysFor,
  ticksFor,
  watchCues,
  type Harness,
  type TimedCue,
} from "../harness";

/** The key a menu's highlight is moved down by (`specs/controls.md`). */
const MENU_DOWN = keysFor("down")[0];

/** A quarter second of untouched title screen, proving it is quiet on its own. */
const QUIET_TICKS = ticksFor(0.25);

/**
 * How long the key is held for the second move, in whole ticks.
 *
 * A whole second. `specs/hopping.md` fixes `HOP_COOLDOWN` (`0.12` s) as the
 * fastest a HELD key repeats anything in this game, so a build that repeated the
 * title menu's highlight while the key was down would have moved — and played the
 * cue — eight times over inside it.
 */
const HOLD_TICKS = ticksFor(1);

/** How many times `cue` sounded in `played`, from index `from` on. */
function sounded(
  played: readonly TimedCue[],
  from: number,
  cue: string,
): number {
  return played.slice(from).filter((entry) => entry.cue === cue).length;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("plays the menu cue once on each move of the highlight, and no more for a key held down", async () => {
  // The title screen as a fresh load opens it: highlight at 0, nothing running.
  h.debug.reset();

  const played = watchCues(h);

  const beforeQuiet = played.length;
  await h.advance(QUIET_TICKS);
  const quiet = sounded(played, beforeQuiet, CUES.menu);
  const opening = h.snapshot();

  // One press: one move.
  const beforeTap = played.length;
  await h.tap(MENU_DOWN);
  const tapped = played
    .slice(beforeTap)
    .filter((entry) => entry.cue === CUES.menu);
  const afterTap = h.snapshot();

  const beforeGap = played.length;
  await h.advance(QUIET_TICKS);
  const gap = sounded(played, beforeGap, CUES.menu);

  // The same key held for a second: still one move (specs/controls.md).
  const beforeHold = played.length;
  await holdFor(h, MENU_DOWN, HOLD_TICKS);
  const held = played
    .slice(beforeHold)
    .filter((entry) => entry.cue === CUES.menu);
  const afterHold = h.snapshot();

  captureStill(h, "menu");

  assertEqual(opening.screen, "title", "the game is on the title screen");
  assertEqual(opening.menuIndex, 0, "the highlight opens on the first item");
  assertEqual(quiet, 0, "no menu cue on the untouched title screen");

  // Each stretch really moved the highlight exactly one item, wrapping over
  // `TITLE_ITEMS` as specs/ui.md fixes.
  assertEqual(
    afterTap.menuIndex,
    1 % TITLE_ITEMS.length,
    "the press moved the highlight one item",
  );
  assertLength(tapped, 1, "menu cues played on the move the press made");

  assertEqual(gap, 0, "no menu cue between the two moves");

  assertEqual(
    afterHold.menuIndex,
    2 % TITLE_ITEMS.length,
    "the held key moved the highlight one further item",
  );
  assertLength(
    held,
    1,
    "menu cues played over the whole second the key was held",
  );
});
