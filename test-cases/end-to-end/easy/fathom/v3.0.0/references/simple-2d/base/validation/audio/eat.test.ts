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
// THE CUE IS READ BY NAME. The game asks the runtime's cue bus for a cue by name
// and the bus announces the play (`specs/progression.md`), so what is asserted
// here is the exact name that file fixes, sounding exactly ONCE on the event's own
// tick — which is the "at most once on that tick" half of the requirement — and
// not at all on the ticks before it.
//
// WHAT THIS DOES NOT DECIDE. What eating scores, which is `scoring/plankton`'s;
// what it does to brightness, which is `brightness/from-eating`'s.

import { afterEach, beforeEach, it } from "vitest";
import { BINDINGS, CUES } from "../constants";
import { assertEqual } from "../assert";
import { poseMoveKeyRun, stockPlankton } from "../fixtures";
import {
  captureReplay,
  createHarness,
  startPlaying,
  ticks,
  type Harness,
} from "../harness";
import { requireSceneHeld, sceneGuard } from "../scene";
import { cuesBeforeEvent, cuesOnEvent, watchForEvent } from "./cues";

/** The key `specs/movement.md` binds the `right` action to first. */
const MOVE_KEY = BINDINGS.right[0];

/**
 * The frames the forager is given to swim into the next plankton.
 *
 * At `FORAGER_SPEED` (`128`) a tile is `0.25 s` and the forager's center enters
 * the next tile half a tile in, so a conforming build eats inside `0.13 s`. Half
 * a second is a hard ceiling four times that, so a build that is merely slow
 * fails here rather than leaving the point inconclusive.
 */
const EAT_TICKS = ticks(0.5);

/** Frames held past the reading, purely so the clip shows the forager grazing. */
const TAIL_TICKS = ticks(0.5);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("plays CUES.eat on the tick the forager eats a plankton, and not before", async () => {
  await startPlaying(h);
  const run = await poseMoveKeyRun(h, "right");
  // The board stocked as a laid-out maze carries it, less the tile the forager
  // rests on, which a pellet under it would be eaten off on the first tick. The
  // run behind the forager is stocked too and never swum, so eating the last
  // plankton — which CLEARS the maze (specs/gameplay.md) — cannot happen on the
  // very event this point is reading a cue off.
  await stockPlankton(h, [run.start]);
  // The forager is this check's own subject, so it is not held to staying put;
  // what the guard still catches is a life lost or the dive leaving live play.
  const watch = await sceneGuard(h, { foragerParked: false });
  const before = h.snapshot();

  const seen = await captureReplay(h, "eat", async () => {
    h.hold(MOVE_KEY);
    try {
      const found = await watchForEvent(
        h,
        (s) => s.planktonRemaining < before.planktonRemaining,
        EAT_TICKS,
      );
      // Held on past the reading, so the clip shows a forager grazing rather
      // than a single step. Nothing after this line can reach an assertion.
      await h.advance(TAIL_TICKS);
      return found;
    } finally {
      h.release(MOVE_KEY);
    }
  });

  requireSceneHeld(h.snapshot(), watch);

  assertEqual(
    seen.hit,
    true,
    `the forager travelled into a plankton and ate it inside the ` +
      `${String(EAT_TICKS)} ticks the check holds the key for, from tile ` +
      `(${String(run.start.tx)}, ${String(run.start.ty)})`,
  );
  assertEqual(
    cuesBeforeEvent(seen, CUES.eat),
    0,
    `times CUES.eat played over the ${String(seen.at - 1)} ticks before the ` +
      "eat — a cue is played on the tick its event happens " +
      "(specs/progression.md)",
  );
  assertEqual(
    cuesOnEvent(seen, CUES.eat),
    1,
    "times CUES.eat played on the tick the forager ate the plankton, which is " +
      "its own tick and at most once on it (specs/progression.md)",
  );
});
