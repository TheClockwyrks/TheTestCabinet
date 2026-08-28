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
// in live play". One plankton is put back on the corridor tile ahead of the
// forager, and the forager SWIMS INTO IT — `specs/gameplay.md` has it eat "the
// plankton on its own tile, the moment its center enters that tile", so swimming
// in is the eat every conforming reading agrees on.
//
// TWO CUES SHARE THAT TICK, and that is the specification's own arrangement: "a
// tick that raises more than one of them plays each of those once". The last
// mouthful is an eat AND a clear, so `CUES.eat` and `CUES.descend` both belong to
// it. What this check reads is that the tick SOUNDED and that the ticks before it
// did not — under this engine a sound carries no name, so telling the two apart
// is a reviewer's job by ear.
//
// NO SCENE GUARD HERE. A guard's whole job is to notice the dive leaving the
// screen it was on; leaving `"playing"` for `"cleared"` IS this point's event.
// Every hunter is in the den instead, so nothing else can disturb the watch.
//
// WHAT THIS ENGINE CANNOT SEE. The cue's NAME, and how many sources one cue is
// made of. `validation/audio/cues.ts` states why, and what these checks assert
// instead.
//
// WHAT THIS DOES NOT DECIDE. The `SCORE_CLEAR` bonus, which is
// `scoring/cleared-bonus`'s; the interstitial, which is `states/cleared`'s; the
// descent, which is `scoring/descend-on-clear`'s.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThanOrEqual } from "../assert";
import { ARROW_KEY, ticksFor } from "../constants";
import { poseMoveKeyRun } from "../fixtures";
import { captureReplay, createHarness, type Harness } from "../harness";
import { denAllExcept, requireSwim, startPlaying } from "../scene";
import { soundsBeforeEvent, soundsOnEvent, watchForEvent } from "./cues";

/** The key `specs/movement.md` binds the `right` action to first. */
const MOVE_KEY = ARROW_KEY.right;

/**
 * The ticks the forager is given to swim one tile into the last plankton.
 *
 * At `FORAGER_SPEED` (`128`) a tile is `0.25 s` and its center enters the next
 * tile half a tile in. One second is a hard ceiling eight times that, so a build
 * that is merely slow fails here rather than leaving the point inconclusive.
 */
const SWIM_TICKS = ticksFor(1);

/** Ticks run past the reading, purely so the clip shows the maze clear. */
const TAIL_TICKS = ticksFor(1);

let h: Harness;

beforeEach(async (ctx) => {
  h = await createHarness(ctx);
});

afterEach(async () => {
  await h.dispose();
});

it("sounds on the tick the maze is cleared, and not before", async () => {
  // A real, browser-trusted gesture first: an engineless build owns its own audio
  // layer and is entitled to open it on the player's first interaction alone
  // (`specs/progression.md`). The key is bound to nothing, so this changes no state.
  await h.armAudio();
  await startPlaying(h);
  const run = await poseMoveKeyRun(h, "right");
  await denAllExcept(h);

  // One mouthful left in the whole maze, one tile ahead of the forager. The
  // fixture's own sealed larder goes with everything else, deliberately: this is
  // a point whose subject is the board running out.
  await h.debug.clearPlankton();
  await h.debug.setPlankton(run.tile.tx + 1, run.tile.ty, true);
  const before = await h.snapshot();

  const watch = await captureReplay(h, "descend", async () => {
    await h.hold(MOVE_KEY);
    try {
      const seen = await watchForEvent(
        h,
        (s) => s.screen === "cleared",
        SWIM_TICKS,
      );
      // Past the reading, so the clip shows the interstitial. Nothing after this
      // line can reach an assertion.
      await h.advance(TAIL_TICKS);
      return seen;
    } finally {
      await h.release(MOVE_KEY);
    }
  });

  // Whether the forager travels at all is the movement points' verdict.
  requireSwim(
    h,
    before.forager,
    watch.snapshot.forager,
    "reach the maze's last plankton",
  );

  assertEqual(
    watch.hit,
    true,
    `the forager ate the maze's last plankton and cleared it inside ` +
      `${String(SWIM_TICKS)} ticks, from tile (${String(run.tile.tx)}, ${String(run.tile.ty)})`,
  );
  assertEqual(
    soundsBeforeEvent(watch),
    0,
    `sounds the build emitted over the ${String(watch.at - 1)} ticks before the ` +
      "maze cleared, on a board holding one plankton and no loose hunter — a " +
      "cue is played on the tick its event happens (specs/progression.md)",
  );
  assertGreaterThanOrEqual(
    soundsOnEvent(watch),
    1,
    "sounds the build emitted on the tick the maze cleared, which is the tick " +
      "CUES.descend is played on (specs/progression.md)",
  );
});
