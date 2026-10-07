// instrumentation/surface-present — the build installed the debug and automation
// surface `specs/instrumentation.md` specifies on `window.__shatter`, it carries
// every operation that file names at `SHATTER_DEBUG_VERSION`, and it is LIVE:
// what it poses the game really holds, and what the game holds it really steps.
//
// THREE HALVES, AND ALL OF THEM ARE THE BUILD'S. An engineless run stands on no
// runtime at all, so the surface itself, the global it is installed on, and the
// clock operations that take the game off real time are deliverables of this
// point. A build that installed nothing leaves every other automated item in this
// project with no way to reach the game; this is the item that names that fault
// plainly, and the harness reports it as `surfaceFault` rather than by throwing so
// that it lands here rather than inside some other check's setup.
//
// PRESENCE ALONE IS NOT ENOUGH. A surface whose operations are all functions and
// whose `snapshot` reports a shape full of zeroes is present and useless, so the
// last third of this point poses a rock through the surface, reads it back off the
// surface, and then advances the game and reads that the well moved it. Nothing
// but a real surface over a real, stepping game passes that.
//
// WHAT IS NOT DEMANDED. `REQUIRED_OPS` is the list `specs/instrumentation.md`
// states for EVERY variant. The torpedo operations and `setRockHealth` are stated
// under `warhead` alone, so a `base` build is correct to carry none of them and
// this point never asks for one; the four `warhead` instrumentation items and the
// `armor` and `torpedo` groups are what decide those, and each of them names the
// operation it could not reach. The keyboard, the overlay and
// muting are not on the surface either: `specs/instrumentation.md` puts them in the
// runtime layer beneath the game, so demanding an operation for any of them would
// fail a perfectly conformant build.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLessThan } from "../assert";
import { ROCK_RADIUS } from "../constants";
import { starDistance } from "../geometry";
import {
  captureStill,
  createHarness,
  failSurface,
  HANDLE,
  poseRock,
  requireRock,
  REQUIRED_OPS,
  SHATTER_DEBUG_VERSION,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";

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

afterEach(async () => {
  await h.dispose();
});

it(`installs a whole, live debug surface on window.${HANDLE}`, async () => {
  // There is no engine to have accepted the surface and no seeded module to have
  // built it: either the build put it on the page or nothing here can reach the
  // game. `surfaceFault` is what the harness found when it looked, and it names
  // the missing piece beside what the specification requires.
  if (h.surfaceFault !== null) failSurface(h.surfaceFault);

  // Reflected rather than invoked: what is asked is that each name is a function,
  // not what calling it does, which is the business of the item that decides it.
  const probed = await h.probe(REQUIRED_OPS);
  assertEqual(
    probed.version,
    SHATTER_DEBUG_VERSION,
    `window.${HANDLE}.version (specs/instrumentation.md)`,
  );
  for (const op of REQUIRED_OPS) {
    assertEqual(probed.ops[op], "function", `window.${HANDLE}.${op}`);
  }

  // And it is live. A rock posed through the surface is the rock the game holds:
  // the size it was given, the radius `specs/collision.md` fixes for that size,
  // and the centre it was placed at.
  await startPlaying(h);
  const id = await poseRock(h, "medium", LIVE_ROCK.x, LIVE_ROCK.y);
  const posed = requireRock(await h.snapshot(), id, "the posed rock");
  assertEqual(posed.size, "medium", "the size the surface was given");
  assertEqual(posed.radius, ROCK_RADIUS.medium, "the radius that size fixes");
  assertEqual(posed.x, LIVE_ROCK.x, "the centre x it was placed at");
  assertEqual(posed.y, LIVE_ROCK.y, "and its centre y");

  // A second of game time later the star has pulled it inward, so the clock
  // operations really run the game's own tick rather than reporting a stored
  // picture (`specs/gravity.md`: every rock is pulled by the well).
  const before = starDistance(posed);
  await h.advance(ticksFor(FALL_TIME));
  await captureStill(h, "surface");
  const fallen = requireRock(await h.snapshot(), id, "a second on");
  assertLessThan(
    starDistance(fallen),
    before,
    "the well moved the posed rock, so the surface steps a live game",
  );
});
