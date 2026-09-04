// Wireworm — screens/pause-freezes: over a second of paused game time the worm
// takes no step and the foe does not move.
//
// `specs/ui.md` on the `paused` screen: the board "is frozen: no worm steps, no
// foe moves, no bolt travels, no phase timer runs, and no cue plays, so a paused
// game is exactly where it was when it was paused".
//
// THE WORLD POSED. One worm of a single segment and one foe, on an empty, quiet
// board — no scattered field, no spawning, no entry, no contact — so the only
// two things that can move are the two the item names. The foe is posed with its
// MIND OFF and its travel on, and a velocity of this check's own choosing: what
// the pause has to stop is locomotion, and a foe that decides nothing cannot
// re-choose a velocity midway and make the reading about its behaviour instead.
//
// THE MOTION IS PROVED FIRST. A board where nothing was moving is frozen by
// doing nothing at all, so the drive runs LIVE_TICKS of live play first and the
// check asserts that both actors really moved over it. LIVE_TICKS covers 0.4 s,
// which is nearly three of level 1's 0.14 s worm steps (`src/constants.ts`,
// WORM_STEP_L1) — long enough that a worm stepping at anything near the stated
// rate has stepped, and short enough to leave the actors clear of the walls.
//
// THE FREEZE IS EXACT. Nothing may drift: a build that leaks one frame of
// simulation behind its menu has already moved the foe by a whole unit, so the
// readings after the pause are compared for equality rather than against a
// tolerance. The pause is raised by the `pause` action's own first bound key —
// `KeyP`, which drives nothing else — as a real key event.
//
// The recording spans the live stretch as well as the paused one, because a
// worm hanging still is only visibly HANGING beside the play it was stopped out
// of.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import {
  captureReplay,
  createHarness,
  foeOf,
  headOf,
  poseFoe,
  poseWorm,
  startPlaying,
  ticksFor,
  wormOf,
  type Harness,
} from "../harness";

/** Where the worm's head is posed: clear of every wall, on an empty board. */
const WORM_C = 8;
const WORM_R = 6;

/** Where the foe is posed, in its own column well clear of the worm. */
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

/** Live play before the pause: 0.4 s, nearly three of level 1's worm steps. */
const LIVE_TICKS = ticksFor(0.4);

/** The paused stretch the item names: over a second of game time. */
const PAUSED_TICKS = ticksFor(1.2);

/** How far the actors must have moved over the live stretch to prove they were. */
const MOVED_UNITS = 8;

/** `pause`'s own first bound key; `KeyP` drives nothing else (specs/controls.md). */
const PAUSE_KEY = "KeyP";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("takes no worm step and moves no foe over a second of paused game time", async () => {
  startPlaying(h);
  const worm = poseWorm(h, WORM_C, WORM_R, 1);
  const dropper = poseFoe(h, "dropper", FOE_C, FOE_R);
  h.debug.setFoeMind(dropper, false);
  h.debug.setFoeVelocity(dropper, 0, FOE_VY);

  const opened = h.snapshot();
  const openedHead = headOf(wormOf(opened, worm));
  const openedFoe = foeOf(opened, dropper);

  const paused = await captureReplay(h, "frozen", async () => {
    await h.advance(LIVE_TICKS);
    const live = h.snapshot();
    await h.tap(PAUSE_KEY);
    const at = h.snapshot();
    await h.advance(PAUSED_TICKS);
    return { live, at };
  });

  // The precondition: both actors really were moving before the pause.
  const liveHead = headOf(wormOf(paused.live, worm));
  assertEqual(
    liveHead.c === openedHead.c && liveHead.r === openedHead.r,
    false,
    "the worm steps off its tile over the live stretch before the pause",
  );
  assertGreaterThan(
    Math.abs(foeOf(paused.live, dropper).y - openedFoe.y),
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

  const atHead = headOf(wormOf(paused.at, worm));
  const laterHead = headOf(wormOf(later, worm));
  assertEqual(
    laterHead.c,
    atHead.c,
    "the worm's head holds its column while the game is paused (specs/ui.md)",
  );
  assertEqual(
    laterHead.r,
    atHead.r,
    "the worm's head holds its row while the game is paused (specs/ui.md)",
  );

  const atFoe = foeOf(paused.at, dropper);
  const laterFoe = foeOf(later, dropper);
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
