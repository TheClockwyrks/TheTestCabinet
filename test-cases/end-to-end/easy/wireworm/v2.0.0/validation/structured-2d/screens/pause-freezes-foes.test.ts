// Wireworm — screens/pause-freezes-foes: no foe moves while the game is paused.
//
// `specs/ui.md` on the `paused` screen: the board "is frozen: no worm steps, no
// foe moves, no bolt travels, and no phase timer runs, so nothing on the board
// raises a cue and a paused game is exactly where it was when it was paused."
// Each of those four is its own point, because a build can stop one and leak
// another and the grade has to say which.
//
// THE WORLD POSED. One foe on an empty, quiet board — no worm, no bolt, no
// scattered field, no spawning, no entry, no contact — so the only thing that
// can move is the one this item names. The foe is posed with its MIND OFF and
// its travel on, and a velocity of this check's own choosing: what the pause has
// to stop is locomotion, and a foe that decides nothing cannot re-choose a
// velocity midway and make the reading about its behaviour instead.
//
// THE MOTION IS PROVED FIRST. A board where nothing was moving is frozen by
// doing nothing at all, so the drive runs LIVE_TICKS of live play first and the
// check asserts the foe really travelled over it.
//
// THE FREEZE IS EXACT. Nothing may drift: a build that leaks one frame of
// simulation behind its menu has already moved the foe by a whole unit, so the
// readings after the pause are compared for equality rather than against a
// tolerance. The pause is raised through the `pause` action's own bound key, as
// a real key event.
//
// The recording spans the live stretch as well as the paused one, because a foe
// hanging still is only visibly HANGING beside the travel it was stopped out of.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, fail } from "../assert";
import {
  captureReplay,
  createHarness,
  foeById,
  poseFoe,
  resetTo,
  startPlaying,
  tapAction,
  ticksFor,
  type FoeSnapshot,
  type Harness,
  type WirewormSnapshot,
} from "../harness";

/** Where the foe is posed, in its own column well clear of the walls. */
const FOE_C = 26;
const FOE_R = 4;

/**
 * The foe's velocity, in logical units per second, straight down.
 *
 * This check's own figure rather than a kind's resting speed: what is under test
 * is that travel stops, so the speed only has to be one a frozen frame could not
 * hide. 120 covers 48 units over the live stretch — a tile and a half — and one
 * leaked frame of it is a whole unit.
 */
const FOE_VY = 120;

/** Live play before the pause: 0.4 s. */
const LIVE_TICKS = ticksFor(0.4);

/** The paused stretch the item names: over a second of game time. */
const PAUSED_TICKS = ticksFor(1.2);

/** How far the foe must have moved over the live stretch to prove it was. */
const MOVED_UNITS = 8;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

/** The posed foe, failing where it is gone from the roster. */
function foe(snapshot: WirewormSnapshot, id: number): FoeSnapshot {
  const found = foeById(snapshot, id);
  if (found === undefined) {
    fail("the posed foe still on the board", "no foe carries its id");
  }
  return found;
}

it("moves no foe over a second of paused game time", async () => {
  resetTo(h);
  startPlaying(h);
  const dropper = poseFoe(h, "dropper", FOE_C, FOE_R);
  h.debug.setFoeMind(dropper, false);
  h.debug.setFoeVelocity(dropper, 0, FOE_VY);

  const openedFoe = foe(h.snapshot(), dropper);

  const paused = await captureReplay(h, "frozen", async () => {
    await h.advance(LIVE_TICKS);
    const live = h.snapshot();
    await tapAction(h, "pause");
    const at = h.snapshot();
    await h.advance(PAUSED_TICKS);
    return { live, at };
  });

  // The precondition: the foe really was travelling before the pause.
  assertGreaterThan(
    Math.abs(foe(paused.live, dropper).y - openedFoe.y),
    MOVED_UNITS,
    "the foe travels over the live stretch before the pause",
  );

  assertEqual(
    paused.at.screen,
    "paused",
    "the pause key opens the pause screen during live play (specs/ui.md)",
  );

  // The verdict: a second of paused game time later, nothing has moved.
  const later = h.snapshot();
  assertEqual(later.screen, "paused", "the game is still paused");

  const atFoe = foe(paused.at, dropper);
  const laterFoe = foe(later, dropper);
  assertEqual(
    laterFoe.x,
    atFoe.x,
    "the foe holds its x while the game is paused (specs/ui.md)",
  );
  assertEqual(
    laterFoe.y,
    atFoe.y,
    "the foe holds its y while the game is paused (specs/ui.md)",
  );
});
