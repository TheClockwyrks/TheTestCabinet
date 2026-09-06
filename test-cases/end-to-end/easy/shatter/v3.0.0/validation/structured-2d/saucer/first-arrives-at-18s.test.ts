// saucer/first-arrives-at-18s — the first saucer of a game turns up about
// eighteen seconds in.
//
// THE RULE. `specs/saucer.md`, The cadence: the first arrival of a game comes
// "`SAUCER_FIRST_DELAY` (`18` seconds) of game time after the game begins". The
// clock is the GAME's, not the wall's, and it starts when the game starts.
//
// WHY BOTH SIDES ARE READ. The field is asserted CLEAR two seconds short of the
// figure and OCCUPIED two seconds past it. Either half alone decides nothing: a
// build that puts a saucer up the instant a game opens passes "one is up by
// twenty seconds", and a build that never spawns one at all passes "none is up at
// sixteen". Together they place the arrival inside a four-second window around the
// stated eighteen, which separates it from every round number a build might have
// picked instead — and from the `12` s a visit lasts and the `25`–`35` s gap that
// follows one.
//
// THE GAME IS REALLY OPENED. The specification times the delay from the moment the
// game begins, so the scenario begins one the way a player does — `reset` to the
// title, then `confirm` on `PLAY` — rather than posing the `playing` screen onto a
// title-screen state. A build that arms its arrival clock when a game OPENS and
// one that carries it from `reset` are then both measured from the moment the
// specification names. See `visits.ts`.
//
// NOTHING ELSE IS LEFT RUNNING. The wave loop is shut and the opening wave taken
// off, the banner run out, and the ship put back at the safe point with its lethal
// contact test shut, so nothing can end the run or spawn into it over the twenty
// seconds. `saucerSpawning` — the one faculty this point is about — is left on,
// exactly as `reset` left it, and NO saucer is added: what turns up has to be the
// game's own arrival. Nothing is posed for the due either — `setSaucerDue` is how
// a check that wants an arrival at a moment of its own gets one, and this check
// wants the build's own first delay.
//
// WHAT THIS DOES NOT DECIDE. Where the saucer enters (`saucer/enters-at-an-edge`,
// `saucer/entry-row-inside-the-range`, `saucer/enters-at-a-random-row`), how long
// it stays (`saucer/despawns-after-12s`)
// or when the next one comes (`saucer/subsequent-gap`).

import { afterEach, beforeEach, it } from "vitest";
import { SAUCER_FIRST_DELAY } from "../constants";
import { assertNotNull, assertNull } from "../assert";
import { captureStill, type Harness } from "../harness";
import {
  createMarchHarness,
  march,
  marchFrames,
  openQuietGame,
} from "./visits";

/**
 * The window the arrival has to fall inside, in seconds of game time.
 *
 * Two seconds either side of `SAUCER_FIRST_DELAY` (`18`). It is wide enough that
 * a build whose accumulator differs from ours by a tick, or which arms its clock
 * on the frame after the game opens rather than on it, is not failed for that —
 * and narrow enough that the window touches no other figure `specs/saucer.md`
 * states.
 */
const MARGIN = 2;
const CLEAR_AT = SAUCER_FIRST_DELAY - MARGIN;
const UP_BY = SAUCER_FIRST_DELAY + MARGIN;

let h: Harness;

beforeEach(async () => {
  h = await createMarchHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves the field clear at 16 s of game time and has a saucer up by 20 s", async () => {
  const opened = await openQuietGame(h);

  await march(h, marchFrames(CLEAR_AT) - opened);
  const early = h.snapshot();

  await march(h, marchFrames(UP_BY) - marchFrames(CLEAR_AT));
  const late = h.snapshot();
  // The first saucer, twenty seconds into a game.
  captureStill(h, "arrival");

  assertNull(
    early.saucer,
    `the saucer slot ${CLEAR_AT} s into a game with the game's own arrival ` +
      `running — the first arrival is due at SAUCER_FIRST_DELAY ` +
      `(${SAUCER_FIRST_DELAY} s) of game time (specs/saucer.md)`,
  );
  assertNotNull(
    late.saucer,
    `the saucer slot ${UP_BY} s into that same game, ${MARGIN} s past ` +
      `SAUCER_FIRST_DELAY (${SAUCER_FIRST_DELAY} s) (specs/saucer.md)`,
  );
});
