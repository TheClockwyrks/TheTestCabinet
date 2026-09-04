// Arc Foundry — effects/build-spark: a landing rock throws its produced spark.
//
// THE REQUIREMENT, from `specs/assets.md`: the build spark is spawned when "a rock
// lands", it carries "a shower of sparks and a snap of arc at the new footprint",
// and an instance of the matching system is spawned "at the position of the event
// that raised it: the build spark at the stamped footprint".
//
// THE PRODUCED SYSTEMS ARE SERVED TO THE LOADER HERE, by `./produced.ts`, because
// a system that never arrived is a system the build cannot play: without it this
// point would decide nothing about any build. What is played is the file the build
// committed, simulated live by the build's own runtime.
//
// WHAT IS READ, AND WHY IT IS MOTION RATHER THAN A BEFORE-AND-AFTER. A rock
// landing puts a candidate on the footprint, so the footprint looks different from
// how it looked a frame earlier whether or not anything was played there — a
// comparison across the drop alone would pass a build with no effects at all. What
// a played system leaves instead is a footprint that keeps changing: the systems
// are "played live and simulated as it plays, so it varies from one firing to the
// next" (`specs/assets.md`). So the footprint is read frame by frame over the
// tenth of a second before the drop and over the tenth of a second after it, and
// the drop must set it moving.
//
// THE WORLD IS EMPTY BUT FOR THE ROCK. `openYard` clears every structure, unit and
// projectile, so nothing else on the yard can move a pixel inside the footprint.
//
// THE BOUND. The region must change on more frames after the drop than before it,
// and on at least half the frames of the window. Half rather than all, because
// nothing fixes how long a spark lasts or how it fades; a shower of sparks
// simulated at all moves on nearly every frame, and a standing candidate on none.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertGreaterThanOrEqual } from "../assert";
import {
  captureReplay,
  createHarness,
  type Harness,
  openYard,
  standCandidate,
  ticks,
} from "../harness";
import { serveProducedAssets } from "./produced";
import { lattice, motion } from "./region";
import { structureCenter } from "../constants";

/** Clear ground, well away from the map's waypoint platforms and its chain. */
const ANCHOR = { col: 24, row: 18 };

/** Inside the `2` by `2` footprint of `specs/yard.md`: `+/-20` about its centre. */
const POINTS = lattice(structureCenter(ANCHOR.col, ANCHOR.row), 16, 4);

const WINDOW = ticks(0.1);
const MOVING = WINDOW / 2;

let h: Harness;

beforeEach(async () => {
  serveProducedAssets();
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("sets the stamped footprint moving when the rock lands", async () => {
  openYard(h, { wave: 1 });
  await h.advance(1);
  const still = await motion(h, POINTS, WINDOW);

  const played = await captureReplay(h, "spark", async () => {
    standCandidate(h, "capacitor", 1, ANCHOR.col, ANCHOR.row);
    await h.advance(1);
    return motion(h, POINTS, WINDOW);
  });

  assertGreaterThan(
    played,
    still,
    "the stamped footprint to change on more frames after a rock lands on it " +
      "than before, so a build spark is played there (specs/assets.md); the " +
      `empty footprint changed on ${still} of ${WINDOW} frames`,
  );
  assertGreaterThanOrEqual(
    played,
    MOVING,
    `the footprint to keep changing across the tenth of a second after the ` +
      `drop, as a live particle system does (specs/assets.md)`,
  );
});
