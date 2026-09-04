// progression/empty-board-does-not-clear — a board that never held a segment is
// being played, not cleared.
//
// THE RULE. `specs/progression.md`, *Clearing a level*: *the clear is that
// removal, so a board that holds no worm segments and has had none removed is
// being played rather than cleared, and the level stands*. The level-clear rule is
// a TRANSITION, not a predicate over the board, and this is the direction that
// says so.
//
// WHY IT IS ITS OWN POINT. `startPlaying` — the ground every mechanic check in
// this suite stands on — poses an EMPTY board, which is only safe because of this
// rule. A build that clears on an empty board makes every posed scenario in the
// suite impossible to arrange, so this is decided in its own right rather than
// folded into `progression/level-clears-on-last-segment`, where a build that
// cleared on nothing and a build that never cleared at all would score the same.
//
// THE BOARD IS LEFT ALONE FOR SEVERAL SECONDS. Nothing is posed on it and nothing
// is driven: the three world gates are off, so no worm enters, no foe arrives and
// no contact is tested, and the only thing that happens over the window is the
// build's own update running against an empty board. Both readings are one
// scenario read twice — the run is still on the level it was on, and it is still
// in live play rather than in some other phase.
//
// THE LEVEL IS POSED AWAY FROM 1 so that a build which clears reads a plainly
// different number rather than one that could be confused with where it started.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";

/** The level the empty board is posed on. */
const LEVEL = 4;

/**
 * How long the board is left standing, in frames.
 *
 * Three seconds, which is more than twice `BANNER_TIME` (`1.3` s) and twice
 * `RESPAWN_TIME` (`1.4` s), so a build that clears on an empty board has time to
 * do it, open the next level's banner, and clear again — and would read several
 * levels on rather than one.
 */
const IDLE_FRAMES = ticksFor(3);

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(() => {
  harness?.dispose();
});

it("holds its level, in live play, over an empty board", async () => {
  startPlaying(harness);
  harness.debug.setLevel(LEVEL);

  await harness.advance(IDLE_FRAMES);

  captureStill(harness, "playing");
  const idled = harness.snapshot();
  assertEqual(idled.level, LEVEL, "level");
  assertEqual(idled.phase, "active", "phase");
});
