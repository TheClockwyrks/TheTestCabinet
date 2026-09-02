// audio/descend — the descend cue.
//
// `specs/progression.md` fixes `CUES.descend` (`"descend"`) as the cue played
// when "a maze is cleared", and governs all seven with one sentence: "Each is
// played on the tick its event happens, and at most once on that tick." It also
// fixes the event itself: "A maze is cleared when the forager eats a plankton and
// none remain in the maze after it."
//
// SO THE CLEAR IS EARNED, not posed. `clearPlankton` takes every plankton off the
// board and `specs/instrumentation.md` is explicit that doing so "scores nothing
// and clears no maze: ... an empty maze the forager has not just eaten from stays
// in live play". Two plankton are put back on the corridor ahead of the forager,
// and the forager SWIMS INTO THEM — `specs/gameplay.md` has it eat "the plankton
// on its own tile, the moment its center enters that tile", so swimming in is the
// eat every conforming reading agrees on.
//
// WHY TWO PLANKTON, AND WHY THAT IS THE WHOLE DESIGN OF THIS CHECK. The clearing
// mouthful is an eat AND a clear, and the specification puts both cues on it: "a
// tick that raises more than one of them plays each of those once". Under this
// engine a sound carries no name, so a check that asked only whether the clearing
// tick sounded would be answered by `CUES.eat` alone and would pass a build that
// never plays `CUES.descend` at all. The first plankton is therefore an ORDINARY
// mouthful, taken on a board that still holds one more, and what it sounds is the
// measured cost of an eat on this build. The second clears the maze, and its own
// tick has to sound MORE than that: whatever `CUES.eat` is worth in sources, the
// clearing tick carries it plus a cue that is not on the ordinary one.
//
// THAT COMPARISON IS WHAT MAKES THE POINT DECIDABLE WITHOUT A NAME. It fixes no
// number of sources per cue, which `validation/audio/cues.ts` explains is the
// build's and not the specification's: a cue made of a tone and a noise burst is
// two sources, and both mouthfuls carry the same eat whatever that number is. The
// only build the comparison rejects is one whose clearing tick carries nothing the
// ordinary one did not — which is a build that played no descend cue.
//
// NO SCENE GUARD HERE. A guard's whole job is to notice the dive leaving the
// screen it was on; leaving `"playing"` for `"cleared"` IS this point's event.
// The posed board carries no predator and no drifter instead, so nothing else
// can disturb the watch.
//
// WHAT THIS ENGINE CANNOT SEE. The cue's NAME, and how many sources one cue is
// made of. `validation/audio/cues.ts` states why, and what these checks assert
// instead.
//
// WHAT THIS DOES NOT DECIDE. The `SCORE_CLEAR` bonus, which is
// `scoring/cleared-bonus`'s; the interstitial, which is `states/cleared`'s; the
// descent, which is `scoring/descend-on-clear`'s.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertGreaterThanOrEqual,
  assertNotEqual,
} from "../assert";
import { ARROW_KEY, ticksFor } from "../constants";
import { poseMoveKeyRun } from "../fixtures";
import {
  captureReplay,
  createHarness,
  type Harness,
  startPlaying,
} from "../harness";

import { soundsBetween, soundsOnTick, watchForEvent } from "./cues";

/** The key `specs/movement.md` binds the `right` action to first. */
const MOVE_KEY = ARROW_KEY.right;

/**
 * The ticks the forager is given to swim two tiles, eating both plankton.
 *
 * At `FORAGER_SPEED` (`128`) a tile is `0.25 s` and its center enters the next
 * tile half a tile in, so the pair is under a second of swimming. Two seconds is a
 * hard ceiling four times that, so a build that is merely slow fails here rather
 * than leaving the point inconclusive.
 */
const SWIM_TICKS = ticksFor(2);

/** Ticks run past the reading, purely so the clip shows the maze clear. */
const TAIL_TICKS = ticksFor(1);

/** What the board holds when only the clearing mouthful is left. */
const LAST_MOUTHFUL = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("sounds more on the tick the maze is cleared than an ordinary mouthful does", async () => {
  // A real, browser-trusted gesture first: an engineless build owns its own audio
  // layer and is entitled to open it on the player's first interaction alone
  // (`specs/progression.md`). The key is bound to nothing, so this changes no state.
  await h.armAudio();
  await startPlaying(h);
  const run = await poseMoveKeyRun(h, "right");

  // Two mouthfuls in the whole maze, on the two corridor tiles ahead of the
  // forager: the board is emptied by the pose, and this is a point whose
  // subject is the board running out.
  await h.debug.setPlankton(run.start.tx + 1, run.start.ty, true);
  await h.debug.setPlankton(run.start.tx + 2, run.start.ty, true);

  const watch = await captureReplay(h, "descend", async () => {
    await h.hold(MOVE_KEY);
    try {
      const seen = await watchForEvent(
        h,
        (s) => s.screen === "cleared",
        SWIM_TICKS,
        // The ordinary mouthful: the first tick the board is down to its last
        // plankton is the tick the first one was swallowed on.
        { mark: (s) => s.planktonRemaining <= LAST_MOUTHFUL },
      );
      // Past the reading, so the clip shows the interstitial. Nothing after this
      // line can reach an assertion.
      await h.advance(TAIL_TICKS);
      return seen;
    } finally {
      await h.release(MOVE_KEY);
    }
  });

  assertEqual(
    watch.hit,
    true,
    `the forager ate both plankton and cleared the maze inside ` +
      `${String(SWIM_TICKS)} ticks, from tile (${String(run.start.tx)}, ${String(run.start.ty)})`,
  );
  assertGreaterThanOrEqual(
    watch.marked,
    0,
    `the board came down to its last plankton over the ${String(watch.at)} ` +
      "ticks before it cleared, which is the ordinary mouthful the clearing " +
      "one is measured against",
  );
  assertNotEqual(
    watch.marked,
    watch.at,
    "the tick the ordinary mouthful was swallowed on, against the tick the " +
      "clearing one was — the forager eats one tile at a time " +
      "(specs/gameplay.md), so the two are different ticks",
  );

  const ordinary = soundsOnTick(watch, watch.marked);
  assertGreaterThanOrEqual(
    ordinary,
    1,
    "sounds the build emitted on the tick the ordinary mouthful was " +
      "swallowed, which CUES.eat is played on (specs/progression.md)",
  );

  assertEqual(
    soundsBetween(watch, 0, watch.marked),
    0,
    `sounds the build emitted over the ${String(watch.marked - 1)} ticks before ` +
      "the first mouthful, on a board holding two plankton and no loose hunter " +
      "— a cue is played on the tick its event happens (specs/progression.md)",
  );
  assertEqual(
    soundsBetween(watch, watch.marked, watch.at),
    0,
    `sounds the build emitted over the ` +
      `${String(Math.max(0, watch.at - watch.marked - 1))} ticks between the two ` +
      "mouthfuls, on which nothing specs/progression.md names a cue for happened",
  );
  assertGreaterThan(
    soundsOnTick(watch, watch.at),
    ordinary,
    `sounds the build emitted on the tick the maze cleared, against the ` +
      `${String(ordinary)} an ordinary mouthful sounded on this build — the ` +
      "clearing tick carries CUES.descend on top of the CUES.eat both mouthfuls " +
      "raise (specs/progression.md)",
  );
});
