// audio/eat — the eat cue.
//
// `specs/progression.md` fixes `CUES.eat` (`"eat"`) as the cue played when "the
// forager eats a plankton", and governs all seven with one sentence: "Each is
// played on the tick its event happens, and at most once on that tick."
//
// So the measurement is: stage one eat, step one tick at a time, and read what
// sounded on the eat's own tick against what sounded on the ticks before it. The
// ticks before are the half of it a build cannot fake — a build that blips every
// tick sounds on the eat's tick too, and fails on the quiet that should have come
// first.
//
// THE EAT IS SWUM INTO, NOT STOOD ON. `specs/gameplay.md` has the forager eat
// "the plankton on its own tile, the moment its center enters that tile", so a
// build entitled to decide eating on tile ENTRY alone would never eat a pellet
// under a forager already standing on it. The pellet the pose left underfoot is
// taken off first, as a non-event, and the eat this check reads is one the
// forager swims into on a corridor posed for the purpose.
//
// WHAT THIS ENGINE CANNOT SEE. The cue's NAME, and how many sources one cue is
// made of. `validation/audio/cues.ts` states why, and what these checks assert
// instead.
//
// WHAT THIS DOES NOT DECIDE. What eating scores, which is `scoring/plankton`'s;
// what it does to brightness, which is `brightness/from-eating`'s.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThanOrEqual } from "../assert";
import { ARROW_KEY, ticksFor } from "../constants";
import { poseMoveKeyRun, stockPlankton } from "../fixtures";
import {
  captureReplay,
  createHarness,
  type Harness,
  startPlaying,
} from "../harness";
import { requireSceneHeld, sceneGuard } from "../scene";
import { soundsBeforeEvent, soundsOnEvent, watchForEvent } from "./cues";

/** The key `specs/movement.md` binds the `right` action to first. */
const MOVE_KEY = ARROW_KEY.right;

/**
 * The ticks the forager is given to swim into the next plankton.
 *
 * At `FORAGER_SPEED` (`128`) a tile is `0.25 s` and the forager's center enters
 * the next tile half a tile in, so a conforming build eats inside `0.13 s`. Half
 * a second is a hard ceiling four times that, so a build that is merely slow
 * fails here rather than leaving the point inconclusive.
 */
const EAT_TICKS = ticksFor(0.5);

/** Ticks held past the reading, purely so the clip shows the forager grazing. */
const TAIL_TICKS = ticksFor(0.5);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("sounds on the tick the forager eats a plankton, and not before", async () => {
  // A real, browser-trusted gesture first: an engineless build owns its own audio
  // layer and is entitled to open it on the player's first interaction alone
  // (`specs/progression.md`), so a cue driven before one would leave a perfectly
  // good build silent. The key is bound to nothing, so this changes no state.
  await h.armAudio();
  await startPlaying(h);
  const run = await poseMoveKeyRun(h, "right");
  // A plankton on every corridor tile but the forager's own, as a laid-out maze
  // carries them: the tile it stands on is bare so nothing sounds before the
  // swim, and the corridor behind it is stocked so the run it swims cannot eat
  // the board empty and clear the maze under the reading.
  await stockPlankton(h, [run.start]);
  // The forager is this check's own subject, so it is not held to staying put;
  // what the guard still catches is a life lost or the dive leaving live play.
  const guard = await sceneGuard(h, { foragerParked: false });
  const before = await h.snapshot();

  const watch = await captureReplay(h, "eat", async () => {
    await h.hold(MOVE_KEY);
    try {
      const seen = await watchForEvent(
        h,
        (s) => s.planktonRemaining < before.planktonRemaining,
        EAT_TICKS,
      );
      // Held on past the reading, so the clip shows a forager grazing rather than
      // a single step. Nothing after this line can reach an assertion.
      await h.advance(TAIL_TICKS);
      return seen;
    } finally {
      await h.release(MOVE_KEY);
    }
  });

  requireSceneHeld(await h.snapshot(), guard);

  assertEqual(
    watch.hit,
    true,
    `the forager ate a plankton inside the ${String(EAT_TICKS)} ticks the ` +
      `check holds the key for, from tile (${String(run.start.tx)}, ${String(run.start.ty)})`,
  );
  assertEqual(
    soundsBeforeEvent(watch),
    0,
    `sounds the build emitted over the ${String(watch.at - 1)} ticks before the ` +
      "eat, on a board where nothing else is happening — a cue is played on the " +
      "tick its event happens (specs/progression.md)",
  );
  assertGreaterThanOrEqual(
    soundsOnEvent(watch),
    1,
    "sounds the build emitted on the tick the forager ate the plankton, which " +
      "is the tick CUES.eat is played on (specs/progression.md)",
  );
});
