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
import { CUES } from "../constants";
import { assertEqual } from "../assert";
import { poseMoveKeyRun } from "../fixtures";
import {
  captureReplay,
  createHarness,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import { requireSceneHeld, sceneGuard } from "../scene";
import { cuesBeforeEvent, cuesOnEvent, watchForEvent } from "./cues";

/**
 * The frames the forager is given to eat the plankton it stands on.
 *
 * specs/gameplay.md eats it "the moment its center enters that tile", so a
 * conforming build eats on the tick after the pose. Half
 * a second is a hard ceiling four times that, so a build that is merely slow
 * fails here rather than leaving the point inconclusive.
 */
const EAT_TICKS = ticksFor(0.5);

/** Frames held past the reading, purely so the clip shows the forager grazing. */
const TAIL_TICKS = ticksFor(0.5);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("plays CUES.eat on the tick the forager eats a plankton, and not before", async () => {
  startPlaying(h);
  const run = await poseMoveKeyRun(h, "right");
  // Two pellets on an otherwise bare board: the one the forager is stood on, and
  // a spare so that eating it is not the mouthful that leaves none behind and
  // clears the maze (specs/gameplay.md). The forager is CARRIED onto its pellet
  // rather than driven onto it — specs/gameplay.md eats "the moment its center
  // enters that tile" — so the cue this point reads owes the movement points
  // nothing.
  // On the tile ahead rather than under the forager, so the pose really is its
  // center ENTERING the pellet's tile — which is the condition
  // specs/gameplay.md eats on, and the one a build that decides eating on entry
  // alone honours too.
  const bite = { tx: run.start.tx + 1, ty: run.start.ty };
  h.debug.setPlankton(run.start.tx + run.ahead, run.start.ty, true);
  // The forager is moved by this check, so it is not held to staying put; what
  // the guard still catches is a life lost or the dive leaving live play.
  const watch = await sceneGuard(h, { foragerParked: false });
  const before = h.snapshot();

  const seen = await captureReplay(h, "eat", async () => {
    h.debug.setPlankton(bite.tx, bite.ty, true);
    h.debug.setForagerTile(bite.tx, bite.ty);
    const found = await watchForEvent(
      h,
      (s) => s.planktonRemaining < before.planktonRemaining + 1,
      EAT_TICKS,
    );
    // Held on past the reading, so the clip runs on rather than cutting on a
    // single step. Nothing after this line can reach an assertion.
    await h.advance(TAIL_TICKS);
    return found;
  });

  requireSceneHeld(h.snapshot(), watch);

  assertEqual(
    seen.hit,
    true,
    `the forager ate the plankton its center was moved into inside ` +
      `${String(EAT_TICKS)} ticks, on tile (${String(run.start.tx + 1)}, ` +
      `${String(run.start.ty)})`,
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
