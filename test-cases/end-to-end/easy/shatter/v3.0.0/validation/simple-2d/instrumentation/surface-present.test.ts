// instrumentation/surface-present — the build returned the debug and automation
// surface `specs/instrumentation.md` specifies beside its state, it carries every
// operation that file names at `SHATTER_DEBUG_VERSION`, and it is LIVE: what it
// poses the game really holds, and what the game holds really steps.
//
// WHERE THE SURFACE COMES FROM, AND WHY THAT IS THE POINT. Under this engine the
// build's `initialize` returns the pair `[state, debug]` and the engine hands the
// second element back from `engine.debug`; nothing is installed on the page and no
// module of the build's is imported here. So the object this reaches for is the
// object the build really returned, and a build that returned no surface, or one
// missing an operation, is named HERE — by the item whose requirement the surface
// is — rather than by whichever other check happened to reach for it first. That is
// what `readDebugSurface` and `missingSurface` in the harness are built to.
//
// PRESENCE ALONE IS NOT ENOUGH. A surface whose operations are all functions and
// whose `snapshot` reports a shape full of zeroes is present and useless, so the
// last third of this point poses a rock through the surface, reads it back off the
// surface, and then advances the game and reads that the well moved it. Nothing but
// a real surface over a real, stepping game passes that.
//
// WHAT IS NOT DEMANDED. `REQUIRED_OPS` is the list `specs/instrumentation.md`
// states for EVERY variant. The torpedo operations and `setRockHealth` are stated
// under `warhead` alone, so a `base` build is correct to carry none of them and
// this point never asks for one; the three `warhead` instrumentation items and the
// `armor` and `torpedo` groups are what decide those. The clock, the keyboard, the
// overlay and muting are not on the surface either: under this engine
// `specs/instrumentation.md` puts all four with the engine, so demanding an
// operation for any of them would fail a perfectly conformant build.

import { afterEach, beforeEach, it } from "vitest";
import { ROCK_RADIUS } from "../../src/constants";
import { assertEqual, assertLessThan } from "../assert";
import { distance, STAR } from "../geometry";
import {
  captureStill,
  createHarness,
  lastRock,
  poseRock,
  rockById,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import { REQUIRED_OPS, SHATTER_DEBUG_VERSION } from "../surface";

/**
 * Where the live rock is posed: a corner of the field 412 units from the star.
 *
 * Far enough out that the well is gentle (about 26 units per second squared,
 * `specs/gravity.md`), which is the point — a second of it moves the rock inward
 * by a dozen units, which is unmistakable against a rock that did not move at all
 * and nowhere near a figure this check has to reason about.
 */
const LIVE_ROCK = { x: 320, y: 620 } as const;

/** The seconds of game time the posed rock is left to fall toward the star. */
const FALL_TIME = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("returns a whole, live debug surface from initialize", async () => {
  // Reflected rather than invoked: what is asked is that each name is a function
  // on the object the build returned, not what calling it does, which is the
  // business of the item that decides it. A build that returned no surface at all
  // fails on the first of these reads, with the `[state, debug]` pair the
  // specification requires named on the `Expected:` line.
  assertEqual(
    h.debug.version,
    SHATTER_DEBUG_VERSION,
    "the surface's version (specs/instrumentation.md)",
  );
  for (const op of REQUIRED_OPS) {
    assertEqual(
      typeof h.debug[op],
      "function",
      `engine.debug.${op} (specs/instrumentation.md)`,
    );
  }

  // And it is live. A rock posed through the surface is the rock the game holds:
  // the size it was given, the radius `specs/rocks.md` fixes for that size, and
  // the centre it was placed at.
  startPlaying(h);
  const id = poseRock(h, "medium", LIVE_ROCK.x, LIVE_ROCK.y);
  const posed = rockById(h.snapshot(), id, "the posed rock");
  assertEqual(posed.size, "medium", "the size the surface was given");
  assertEqual(posed.radius, ROCK_RADIUS.medium, "the radius that size fixes");
  assertEqual(posed.x, LIVE_ROCK.x, "the centre x it was placed at");
  assertEqual(posed.y, LIVE_ROCK.y, "and its centre y");
  assertEqual(
    lastRock(h.snapshot()).id,
    id,
    "the rock the surface added is the last entry of the roster",
  );

  // A second of game time later the star has pulled it inward, so a frame the
  // engine advances really runs the game's own tick rather than reporting a
  // stored picture (`specs/gravity.md`: every rock is pulled by the well).
  const before = distance(posed, STAR);
  await h.advance(ticksFor(FALL_TIME));
  captureStill(h, "surface");
  const fallen = rockById(h.snapshot(), id, "a second on");
  assertLessThan(
    distance(fallen, STAR),
    before,
    "the well moved the posed rock, so the surface steps a live game",
  );
});
